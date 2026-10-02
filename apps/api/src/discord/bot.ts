// docs/22: the bot. What each gateway event does: a slash command, a vote button, a line in #game-chat, a member who
// left the Discord server. Only the group's server counts; everything else, direct messages included, is dropped.
import type { Switches } from "./lines.js";
import { Gateway, type GatewayDeps, type GatewayState } from "./gateway.js";
import type { BotMessage, BotRest, Rest } from "./rest.js";
import { COMMANDS, runCommand, type CommandDeps, type Reply } from "./commands.js";
import { ChatLimit, discordChatName, fromPerson, gameText, type DiscordMessage } from "./chat.js";
import { readPress } from "./votes.js";

const EPHEMERAL = 64;
const TEXT = 0;
const FORUM = 15;

export type BotDeps = {
  token: string;
  guild: string;
  clientId: string | null;
  rest: BotRest;
  log: (o: unknown, m: string) => void;
  switches: () => Promise<Switches>;
  commands: CommandDeps;
  /** A vote button or the menu, by the site's rule. */
  vote: (discordId: string, pollId: string, choices: string[]) => Promise<{ ok: boolean; text: string }>;
  /** chat.fromDiscord, when somebody is on; false when nobody is (nothing sent, nothing woken). */
  toGame: (line: { name: string; text: string; member: string | null }) => Promise<"sent" | "nobody" | "failed">;
  memberName: (discordId: string) => Promise<{ userId: string; mcName: string | null } | null>;
  memberChanged: (discordId: string, inGuild: boolean) => Promise<void>;
  presence: () => string;
  gateway?: (d: GatewayDeps) => Gateway;
  now?: () => number;
};

type Interaction = {
  id: string;
  token: string;
  type: number;
  guild_id?: string;
  channel_id?: string;
  member?: { user?: { id: string } };
  data?: { name?: string; options?: Array<{ name: string; type: number; value?: unknown; options?: unknown[] }>; custom_id?: string; values?: string[] };
};

export class Bot {
  readonly gateway: Gateway;
  inGuild = false;
  private channels = new Map<string, { name: string; type: number; tags?: Array<{ id: string; name: string }> }>();
  private registered = false;
  private presenceText = "";
  private presenceTimer: NodeJS.Timeout | null = null;
  private readonly limit: ChatLimit;

  constructor(private readonly d: BotDeps) {
    const make = d.gateway ?? ((g: GatewayDeps) => new Gateway(g));
    this.gateway = make({ token: d.token, log: d.log, onDispatch: (t, data) => void this.onDispatch(t, data).catch((err) => d.log({ err: String(err), t }, "discord bot: event failed")) });
    this.limit = new ChatLimit(d.now);
  }

  start() {
    this.gateway.start();
    const tick = () => {
      const text = this.d.presence();
      if (text !== this.presenceText) {
        this.presenceText = text;
        this.gateway.setPresence({ text, status: /asleep|switched off|crashed|can't reach/i.test(text) ? "idle" : "online" });
      }
    };
    tick();
    this.presenceTimer = setInterval(tick, 60_000); // at most once a minute (docs/22 §3)
    this.presenceTimer.unref?.();
  }

  stop() {
    this.gateway.stop();
    if (this.presenceTimer) clearInterval(this.presenceTimer);
  }

  /** For /health. */
  state(): "on" | "refused" | "reconnecting" {
    const s: GatewayState = this.gateway.state;
    return s === "on" ? "on" : s === "refused" ? "refused" : "reconnecting";
  }

  /** The Bot part of the settings card. */
  overview() {
    const list = (type: number) => [...this.channels].filter(([, c]) => c.type === type).map(([id, c]) => ({ id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
    return {
      state: this.gateway.state,
      tag: this.gateway.user?.tag ?? null,
      refused: this.gateway.refusedReason,
      missingIntents: this.gateway.missingIntents,
      inGuild: this.inGuild,
      textChannels: list(TEXT),
      forums: list(FORUM),
    };
  }

  channelName(id: string): string | null {
    return this.channels.get(id)?.name ?? null;
  }

  /** The forum's tag called `name` (Vote, Boss, Trial, Season, News), if Alex made one. The bot never makes tags. */
  tagFor(forum: string, name: string): string[] {
    const tag = this.channels.get(forum)?.tags?.find((t) => t.name.toLowerCase() === name.toLowerCase());
    return tag ? [tag.id] : [];
  }

  // ---- posting (used by the Announcer for votes, docs/22 §4 and §13) -------------------------------------------------

  async createPost(forum: string, title: string, message: BotMessage, tag: string): Promise<{ ok: true; threadId: string; messageId: string } | { ok: false; error: string; gone: boolean }> {
    const r: Rest = await this.d.rest.createPost(forum, title, message, this.tagFor(forum, tag));
    if (!r.ok) return { ok: false, error: r.error, gone: r.status === 404 || r.status === 403 };
    const t = r.data as { id: string; message?: { id: string } };
    return { ok: true, threadId: t.id, messageId: t.message?.id ?? t.id };
  }

  async sendTo(channel: string, message: BotMessage): Promise<{ ok: true; id: string } | { ok: false; retry: boolean; error: string }> {
    const r = await this.d.rest.send(channel, message);
    if (r.ok) return { ok: true, id: (r.data as { id?: string } | null)?.id ?? "" };
    // 403: the bot cannot see or write in that channel (a private channel it has not been let into)
    return { ok: false, retry: r.status === null || (r.status ?? 0) >= 500 || r.status === 429, error: r.status === 403 ? "the bot cannot write in that channel: add Deepslate Works to the channel's permissions" : r.error };
  }

  async edit(channel: string, messageId: string, message: Partial<BotMessage>): Promise<{ ok: boolean; retry: boolean; error?: string }> {
    const r = await this.d.rest.edit(channel, messageId, message);
    if (r.ok) return { ok: true, retry: false };
    return { ok: false, retry: r.status === null || (r.status ?? 0) >= 500 || r.status === 429, error: r.error };
  }

  // ---- events ---------------------------------------------------------------------------------------------------

  private async onDispatch(type: string, data: unknown) {
    const g = (data as { guild_id?: string } | null)?.guild_id;
    switch (type) {
      case "READY":
        await this.register();
        return;
      case "GUILD_CREATE": {
        const guild = data as { id: string; unavailable?: boolean; channels?: Array<{ id: string; name: string; type: number; available_tags?: Array<{ id: string; name: string }> }> };
        if (guild.id !== this.d.guild || guild.unavailable) return;
        this.inGuild = true;
        this.channels.clear();
        for (const c of guild.channels ?? []) this.channels.set(c.id, { name: c.name, type: c.type, tags: c.available_tags });
        // the bot was just added from the card (or came back): the slash commands could not be registered before it was in
        await this.register();
        return;
      }
      case "GUILD_DELETE":
        if ((data as { id?: string }).id === this.d.guild && !(data as { unavailable?: boolean }).unavailable) this.inGuild = false;
        return;
      case "CHANNEL_CREATE":
      case "CHANNEL_UPDATE": {
        const c = data as { id: string; name: string; type: number; guild_id?: string; available_tags?: Array<{ id: string; name: string }> };
        if (c.guild_id === this.d.guild) this.channels.set(c.id, { name: c.name, type: c.type, tags: c.available_tags });
        return;
      }
      case "CHANNEL_DELETE":
        this.channels.delete((data as { id: string }).id);
        return;
      case "GUILD_MEMBER_REMOVE":
      case "GUILD_MEMBER_ADD": {
        if (g !== this.d.guild) return;
        const user = (data as { user?: { id?: string } }).user;
        if (user?.id) await this.d.memberChanged(user.id, type === "GUILD_MEMBER_ADD");
        return;
      }
      case "INTERACTION_CREATE":
        return this.interaction(data as Interaction);
      case "MESSAGE_CREATE":
        if (g !== this.d.guild) return;
        return this.message(data as DiscordMessage);
    }
  }

  private async register() {
    if (this.registered) return;
    const app = this.d.clientId ?? this.gateway.applicationId;
    if (!app) return this.d.log({}, "discord bot: no application id, slash commands not registered");
    const r = await this.d.rest.registerCommands(app, this.d.guild, [...COMMANDS]);
    if (r.ok) this.registered = true;
    else this.d.log({ err: r.error }, "discord bot: could not register the slash commands");
  }

  private async interaction(i: Interaction) {
    if (i.guild_id !== this.d.guild) return; // another server, or a direct message: dropped
    const who = i.member?.user?.id;
    if (!who) return;
    const sw = await this.d.switches();
    if (i.type === 2) {
      if (!sw.commands) return this.answer(i, { content: "Slash commands are switched off.", ephemeral: true });
      return this.answerSlow(i, () => runCommand(this.d.commands, i.data?.name ?? "", i.data?.options as never, who));
    }
    if (i.type === 3) {
      const press = readPress(i.data?.custom_id ?? "", i.data?.values);
      if (!press) return;
      if (!sw.voteButtons) return this.answer(i, { content: "Voting in Discord is switched off. Vote on the site.", ephemeral: true });
      return this.answerSlow(i, async () => {
        const r = await this.d.vote(who, press.pollId, press.choices);
        return { content: r.text, ephemeral: true };
      });
    }
  }

  private body(r: Reply) {
    return { content: r.content.slice(0, 2000), allowed_mentions: { parse: [] }, ...(r.ephemeral ? { flags: EPHEMERAL } : {}) };
  }

  private async answer(i: Interaction, r: Reply) {
    const res = await this.d.rest.respond(i.id, i.token, { type: 4, data: this.body(r) });
    if (!res.ok) this.d.log({ err: res.error }, "discord bot: could not answer");
  }

  /** Answered within Discord's 3 seconds when the work is quick; otherwise "thinking…" first and the answer after. */
  private async answerSlow(i: Interaction, work: () => Promise<Reply>) {
    const job = work().catch((e): Reply => {
      this.d.log({ err: String(e) }, "discord bot: command failed");
      return { content: "Something went wrong. Try again in a minute.", ephemeral: true };
    });
    const quick = await Promise.race([job, new Promise<null>((r) => setTimeout(() => r(null), 2200).unref?.())]);
    if (quick) return this.answer(i, quick);
    await this.d.rest.respond(i.id, i.token, { type: 5, data: { flags: EPHEMERAL } });
    const late = await job;
    const app = this.d.clientId ?? this.gateway.applicationId;
    if (app) await this.d.rest.editReply(app, i.token, { content: late.content.slice(0, 2000), allowed_mentions: { parse: [] } });
  }

  /** docs/22 §5: a line in #game-chat into the game, through chat.fromDiscord. */
  private async message(m: DiscordMessage) {
    const sw = await this.d.switches();
    if (!sw.chatToGame || !sw.chatChannel || m.channel_id !== sw.chatChannel || !fromPerson(m)) return;
    const text = gameText(m, (id) => this.channelName(id));
    if (!text) return;
    if (!this.limit.take(m.author!.id)) {
      await this.d.rest.react(m.channel_id, m.id, "🐌");
      return;
    }
    const member = await this.d.memberName(m.author!.id);
    const name = discordChatName(member?.mcName || m.member?.nick || m.author!.global_name || m.author!.username) || "someone";
    await this.d.toGame({ name, text, member: member?.userId ?? null });
  }
}

