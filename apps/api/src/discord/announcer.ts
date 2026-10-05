// docs/21 §3: the Discord feed. Reads the event log after a cursor every 3 s and posts what `lines.ts` makes of each row
// to the feed's webhook (and crashes and problems to the admin one). Its own loop: a dead webhook or a Discord outage
// never slows the recorder, the door or a page.
// docs/22 §13: with the forum season-updates (its webhook, or the bot), votes, news and We're live are forum posts there
// (replies in the same post), and #game-chat (the feed webhook) also carries the game's chat.
import { CHANGELOG_OPENER, CHANGELOG_TITLE, changeText, type Change } from "../changelog.js";
import { isKnownHarmless } from "../events/parse.js";
import type { Attachment, Message, Sent, Webhook, Where } from "./webhook.js";
import type { BotMessage, Component } from "./rest.js";
import {
  actionOf, advancementText, asPlayer, asServer, backText, chatText, crashAdminText, crashFeedText, deathRun, deathText, isStale,
  joinText, leaveText, LIVE_TITLE, liveText, metaOf, newsMessage, packText, paramsOf, postTitle, problemText, refusedText, reminderMessage,
  restartText, resultOf, seasonPost, seasonReply, stopText, TEST_TEXT, voteClosedText, voteMessage, welcomeText,
  type Brand, type Channel, type FeedEvent, type PollView, type SeasonInfo, type Switches,
} from "./lines.js";

export type PostRow = { key: string; channel: Channel; messageId: string; postedAt: Date; editedAt: Date | null; via?: "webhook" | "bot"; threadId?: string | null };

/** What the Announcer needs of the bot (docs/22 §4): votes with buttons are the bot's own forum posts. */
export type VotePoster = {
  /** In the server, as last heard. Sending is plain REST and does not need the gateway to be connected this second. */
  readonly inGuild: boolean;
  /** Not heard from Discord yet whether it is in the server (api has just started, the gateway is still connecting). */
  readonly connecting?: boolean;
  createPost(forum: string, title: string, message: BotMessage, tag: string): Promise<{ ok: true; threadId: string; messageId: string } | { ok: false; error: string; gone: boolean }>;
  edit(channel: string, messageId: string, message: Partial<BotMessage>): Promise<{ ok: boolean; retry: boolean; error?: string }>;
  tagFor(forum: string, name: string): string[];
  /** A plain message from the bot into a channel (the admin channel picked on the card). */
  sendTo(channel: string, message: BotMessage): Promise<{ ok: true; id: string } | { ok: false; retry: boolean; error: string }>;
  channelName(id: string): string | null;
  components(poll: { id: string; options: unknown; multiple: boolean }, closed: boolean): Component[];
  pollShape(id: string): Promise<{ id: string; options: unknown; multiple: boolean } | null>;
};
export type LogEntry = { at: string; channel: Channel; what: string; ok: boolean; error?: string };
export type FeedState = { cursor: string | null; hash: string; refused: Partial<Record<Channel, string>>; log: LogEntry[] };

export type FeedStore = {
  newestEventId(): Promise<bigint>;
  eventsAfter(id: bigint, limit: number): Promise<FeedEvent[]>;
  loadState(): Promise<FeedState | null>;
  saveState(s: FeedState): Promise<void>;
  /** A linked member's Minecraft account; null for anybody who has not linked (they are not named, §3). */
  member(uuid: string): Promise<{ userId: string } | null>;
  online(): Promise<number>;
  vote(kind: PollView["kind"], id: string): Promise<PollView | null>;
  /** Open votes with a closing date in the next 24 hours that were open before that mark. */
  remindable(now: Date): Promise<PollView[]>;
  unvoted(kind: PollView["kind"], id: string): Promise<{ discordIds: string[]; others: number }>;
  news(id: string): Promise<{ body: string; image: string | null } | null>;
  picture(file: string): Promise<Attachment | null>;
  /** What the last sync did to the pack (players/pack.ts). */
  packChange(): Promise<{ version: string; previous: string | null; changed: number; at: Date } | null>;
  post(key: string): Promise<PostRow | null>;
  savePost(row: PostRow): Promise<void>;
  addError(message: string, meta: Record<string, unknown>): Promise<void>;
  switches(): Promise<Switches>;
  brand(): Promise<Brand>;
  /** A season's file by its id (docs/21 §6); absent or null: season moments are not posted. */
  season?(id: string): Promise<SeasonInfo | null>;
  /** Is this advancement title a boss, a trial or a wake of the current season? Those have lines of their own. */
  seasonTitle?(title: string): Promise<boolean>;
};

type Deps = {
  store: FeedStore;
  feed: Webhook | null;
  admin: Webhook | null;
  updates?: Webhook | null; // docs/22 §13: the forum season-updates
  bot?: VotePoster | null; // docs/22: set when DISCORD_BOT_TOKEN is
  changes?: Change[]; // the change log's entries (changelog.ts); absent: no change log post
  chatRelay?: boolean; // docs/22 §5: game chat to #game-chat needs the bot (the chat channel is picked through it)
  portal: string; // https://deepslate.dsw.test
  log: (o: unknown, m: string) => void;
  now?: () => Date;
};

const ROUND_MS = 3000;
const BATCH = 50;
const SHORT_MS = 2 * 60_000; // a leave within 2 minutes of the join, a rejoin within 2 minutes of the leave
const RUN_MS = 5 * 60_000; // deaths of one player closer together than this are a run
const EDIT_GAP_MS = 60_000; // a vote's count is edited at most once a minute
const BACK_MS = 30 * 60_000; // "The server is back." only after a down line of ours this recent
const PROBLEM_REPEAT_MS = 6 * 60 * 60_000;
const PROBLEMS_PER_HOUR = 10;

type Outcome = { ok: true; id: string; channelId: string } | { ok: false; retry: boolean; gone?: boolean };
const CHANNELS: Channel[] = ["feed", "admin", "updates"];

export class Announcer {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private st: FeedState | null = null;
  private dirtyState = false;
  /** Outputs of the event in hand already delivered, so that a retry does not post them twice. */
  private partial: { id: bigint; done: Set<number> } | null = null;
  private lastJoin = new Map<string, number>();
  private pendingLeaves = new Map<string, { name: string; at: number; due: number }>();
  private deaths = new Map<string, { count: number; lastAt: number; messageId: string; base: string }>();
  private dirtyVotes = new Set<string>();
  private downPostedAt: number | null = null;
  private problems = new Map<string, number>();
  private problemTimes: number[] = [];
  private remindedAt = 0;
  private readonly now: () => Date;

  constructor(private readonly d: Deps) {
    this.now = d.now ?? (() => new Date());
  }

  get configured(): boolean {
    return Boolean(this.d.feed || this.d.admin || this.d.updates || this.d.bot);
  }

  /** The admin channel picked on the card, posted to by the bot; read at every round. */
  private adminChannel = "";

  /** Crashes and problems go to the picked channel through the bot; DISCORD_WEBHOOK_ADMIN only while none is picked. */
  private botAdmin(): boolean {
    return Boolean(this.adminChannel && this.d.bot?.inGuild);
  }

  /** The bot is set up but has not heard from Discord yet: what is meant for it waits a round, it is not dropped or sent round it. */
  private botSoon(): boolean {
    return Boolean(this.d.bot && !this.d.bot.inGuild && this.d.bot.connecting);
  }

  private canAdmin(): boolean {
    return this.botAdmin() || (Boolean(this.adminChannel) && this.botSoon()) || this.usable("admin") !== null;
  }

  /** docs/22 §13: with the updates forum (or the bot) votes, news and We're live go there; without, docs/21's one feed. */
  private get twoChannels(): boolean {
    return Boolean(this.d.updates || this.d.bot);
  }

  start() {
    if (!this.configured) return; // §11: with no webhook set, nothing changes anywhere
    const tick = () => void this.round().catch((err) => this.d.log({ err: String(err) }, "discord feed round failed"));
    this.timer = setInterval(tick, ROUND_MS);
    setTimeout(tick, 5000).unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** For /health: off (no feed webhook), refused (Discord said no to it) or on. */
  feedState(): "on" | "off" | "refused" {
    if (!this.d.feed) return "off";
    return !this.d.feed.valid || this.st?.refused.feed === this.d.feed.hash ? "refused" : "on";
  }

  private hook(ch: Channel): Webhook | null {
    return (ch === "updates" ? this.d.updates : this.d[ch]) ?? null;
  }

  private hookHash(): string {
    return `${this.d.feed?.hash ?? ""}:${this.d.admin?.hash ?? ""}${this.d.updates ? `:${this.d.updates.hash}` : ""}`;
  }

  private async load(): Promise<FeedState> {
    if (this.st) return this.st;
    const saved = await this.d.store.loadState();
    const hash = this.hookHash();
    // First run, or a different webhook: start at the newest event. Switching the feed on never posts history.
    if (!saved || saved.hash !== hash || saved.cursor === null) {
      this.st = { cursor: (await this.d.store.newestEventId()).toString(), hash, refused: saved?.hash === hash ? saved.refused : {}, log: saved?.log ?? [] };
      this.dirtyState = true;
    } else this.st = saved;
    for (const ch of CHANNELS) {
      const hook = this.hook(ch);
      if (hook && !hook.valid) await this.refuse(ch, "not a Discord webhook address");
    }
    return this.st;
  }

  async round(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const st = await this.load();
      const sw = await this.d.store.switches();
      this.adminChannel = sw.adminChannel ?? "";
      if (sw.paused) {
        // nothing posted and nothing queued: the cursor moves on
        const newest = (await this.d.store.newestEventId()).toString();
        if (st.cursor !== newest) [st.cursor, this.dirtyState] = [newest, true];
        this.pendingLeaves.clear();
        this.dirtyVotes.clear();
        this.partial = null;
        return;
      }
      const events = await this.d.store.eventsAfter(BigInt(st.cursor ?? "0"), BATCH);
      for (let i = 0; i < events.length; i++) {
        const e = events[i]!;
        const now = this.now();
        if (e.kind === "CHAT") {
          // docs/22 §5: what one player says inside a second is one message
          let j = i;
          while (j + 1 < events.length && events[j + 1]!.kind === "CHAT" && events[j + 1]!.actor === e.actor && events[j + 1]!.at.getTime() - e.at.getTime() < 1000) j++;
          if (!isStale(e, now) && !(await this.chat(events.slice(i, j + 1), sw))) break;
          st.cursor = events[j]!.id.toString();
          this.partial = null;
          this.dirtyState = true;
          i = j;
          continue;
        }
        if (!isStale(e, now)) {
          const done = await this.handle(e, sw, now);
          if (!done) break; // Discord is away: this event again at the next round
        }
        st.cursor = e.id.toString();
        this.partial = null;
        this.dirtyState = true;
      }
      await this.duties(sw);
    } finally {
      if (this.dirtyState && this.st) {
        this.dirtyState = false;
        await this.d.store.saveState(this.st).catch((err) => this.d.log({ err: String(err) }, "discord feed: could not save its place"));
      }
      this.busy = false;
    }
  }

  // ---- delivering ---------------------------------------------------------------------------------------------------

  private record(entry: Omit<LogEntry, "at">) {
    if (!this.st) return;
    this.st.log = [{ at: this.now().toISOString(), ...entry }, ...this.st.log].slice(0, 20);
    this.dirtyState = true;
  }

  private async refuse(ch: Channel, error: string) {
    const hook = this.hook(ch);
    if (!hook || !this.st || this.st.refused[ch] === hook.hash) return;
    this.st.refused[ch] = hook.hash;
    this.dirtyState = true;
    this.d.log({ channel: ch, error }, "discord feed: webhook refused");
    await this.d.store.addError(refusedText(ch), { discord: ch, error: error.slice(0, 200) }).catch(() => undefined);
  }

  /** Posts Discord took whose row could not be written: held here, so that the retry does not post them a second time. */
  private unsaved = new Map<string, PostRow>();

  /** Writes a post's row. A database error after Discord took the message must not end the round: the row is held and written later. */
  private async keep(row: PostRow): Promise<void> {
    try {
      await this.d.store.savePost(row);
      this.unsaved.delete(row.key);
    } catch (err) {
      if (!this.unsaved.has(row.key)) this.d.log({ err: String(err), key: row.key }, "discord feed: could not save a post's row; held in memory");
      this.unsaved.set(row.key, row);
    }
  }

  private async postOf(key: string): Promise<PostRow | null> {
    const held = this.unsaved.get(key);
    if (!held) return this.d.store.post(key);
    await this.keep(held); // the database may be back
    return held;
  }

  private usable(ch: Channel): Webhook | null {
    const hook = this.hook(ch);
    if (!hook || !hook.valid || this.st?.refused[ch] === hook.hash) return null;
    return hook;
  }

  private async outcome(ch: Channel, what: string, r: Sent): Promise<Outcome> {
    if (r.ok) {
      this.record({ channel: ch, what, ok: true });
      return { ok: true, id: r.id, channelId: r.channelId };
    }
    this.record({ channel: ch, what, ok: false, error: r.error });
    if (r.refused) await this.refuse(ch, r.error);
    return { ok: false, retry: !r.dropped && !r.refused, gone: r.gone };
  }

  /** Output number `n` of the event in hand: delivered at most once even if the event is tried again. */
  private async send(e: FeedEvent | null, n: number, ch: Channel, what: string, msg: Message, file?: Attachment, where: Where = {}): Promise<Outcome> {
    if (e && this.partial?.id === e.id && this.partial.done.has(n)) return { ok: true, id: "", channelId: "" };
    if (ch === "admin" && this.adminChannel && this.botSoon()) return { ok: false, retry: true };
    if (ch === "admin" && this.botAdmin()) {
      const r = await this.d.bot!.sendTo(this.adminChannel, { content: msg.content, embeds: msg.embeds, allowed_mentions: msg.allowed_mentions, ...(msg.flags ? { flags: msg.flags } : {}) });
      this.record({ channel: "admin", what, ok: r.ok, ...(r.ok ? {} : { error: r.error }) });
      const out: Outcome = r.ok ? { ok: true, id: r.id, channelId: this.adminChannel } : { ok: false, retry: r.retry };
      if (e && (out.ok || !out.retry)) {
        if (this.partial?.id !== e.id) this.partial = { id: e.id, done: new Set() };
        this.partial.done.add(n);
      }
      return out;
    }
    const hook = this.usable(ch);
    if (!hook) return { ok: false, retry: false };
    const r = await this.outcome(ch, what, await hook.send(msg, file, where));
    // gone (the post was deleted by hand) is not done: the caller makes the post again, and if that has to wait a round this is sent again
    if (e && (r.ok || (!r.retry && !r.gone))) {
      if (this.partial?.id !== e.id) this.partial = { id: e.id, done: new Set() };
      this.partial.done.add(n);
    }
    return r;
  }

  private async edit(ch: Channel, what: string, messageId: string, msg: Message, threadId?: string | null): Promise<Outcome> {
    const hook = this.usable(ch);
    if (!hook) return { ok: false, retry: false };
    return this.outcome(ch, what, await hook.edit(messageId, msg, threadId));
  }

  /** Send a test line to one channel (Admin → Site settings → Discord). Works while paused, and on a refused webhook. */
  async test(ch: Channel): Promise<{ ok: boolean; error?: string }> {
    if (ch === "admin") {
      this.adminChannel = (await this.d.store.switches()).adminChannel ?? "";
      if (this.botAdmin()) {
        await this.load();
        const r = await this.send(null, 0, "admin", "test", asServer(await this.d.store.brand(), TEST_TEXT));
        if (this.dirtyState && this.st) {
          this.dirtyState = false;
          await this.d.store.saveState(this.st).catch(() => undefined);
        }
        return r.ok ? { ok: true } : { ok: false, error: this.st?.log[0]?.error ?? "not taken" };
      }
    }
    const hook = this.hook(ch);
    if (!hook) return { ok: false, error: `no webhook set (DISCORD_WEBHOOK_${ch.toUpperCase()})` };
    await this.load();
    const brand = await this.d.store.brand();
    // a forum takes posts, not lines: the test makes one and replies in it, the three calls §13 builds on
    if (ch === "updates") return this.forumTest(hook, brand);
    const r = await this.outcome(ch, "test", await hook.send(asServer(brand, TEST_TEXT)));
    if (r.ok && this.st?.refused[ch]) {
      delete this.st.refused[ch];
      this.dirtyState = true;
    }
    if (this.dirtyState && this.st) {
      this.dirtyState = false;
      await this.d.store.saveState(this.st).catch(() => undefined);
    }
    return r.ok ? { ok: true } : { ok: false, error: this.st?.log[0]?.error ?? "not taken" };
  }

  /**
   * docs/22 §13, checked against the real forum: a post started with `thread_name`, a reply in it with `thread_id`, and
   * that reply edited with `thread_id`. The error says which of the three Discord would not do.
   */
  private async forumTest(hook: Webhook, brand: Brand): Promise<{ ok: boolean; error?: string }> {
    const finish = async (ok: boolean, error?: string) => {
      if (ok && this.st?.refused.updates) {
        delete this.st.refused.updates;
        this.dirtyState = true;
      }
      if (this.dirtyState && this.st) {
        this.dirtyState = false;
        await this.d.store.saveState(this.st).catch(() => undefined);
      }
      return ok ? { ok: true } : { ok: false, error };
    };
    const post = await hook.send(asServer(brand, TEST_TEXT), undefined, { threadName: "Test from Deepslate Works" });
    this.record({ channel: "updates", what: "test post", ok: post.ok, ...(post.ok ? {} : { error: post.error }) });
    if (!post.ok) {
      if (post.refused) await this.refuse("updates", post.error);
      return finish(false, `starting a post (thread_name): ${post.error}`);
    }
    if (!post.channelId) return finish(false, "Discord took the message but gave no post id back: is this webhook in the forum season-updates?");
    const reply = await hook.send(asServer(brand, "A reply in the same post."), undefined, { threadId: post.channelId });
    this.record({ channel: "updates", what: "test reply", ok: reply.ok, ...(reply.ok ? {} : { error: reply.error }) });
    if (!reply.ok) return finish(false, `replying in the post (thread_id): ${reply.error}`);
    const edited = await hook.edit(reply.id, asServer(brand, "A reply in the same post, edited."), post.channelId);
    this.record({ channel: "updates", what: "test edit", ok: edited.ok, ...(edited.ok ? {} : { error: edited.error }) });
    if (!edited.ok) return finish(false, `editing the reply (thread_id): ${edited.error}`);
    return finish(true);
  }

  /** What the settings card shows. */
  async overview() {
    await this.load().catch(() => null);
    const one = async (ch: Channel) => {
      const hook = this.hook(ch);
      if (!hook) return { state: "unset" as const };
      if (!hook.valid || this.st?.refused[ch] === hook.hash) return { state: "refused" as const };
      const info = await hook.info();
      if (!info.ok) return info.refused ? { state: "refused" as const } : { state: "unreachable" as const, error: info.error };
      return { state: "ok" as const, name: info.name, channel: info.channel };
    };
    this.adminChannel = (await this.d.store.switches().catch(() => null))?.adminChannel ?? this.adminChannel;
    const adminView = async () => (this.botAdmin() ? { state: "ok" as const, name: "the bot", channel: this.d.bot!.channelName(this.adminChannel) } : one("admin"));
    // The card says what the last real send to each channel did (Alex, 2026-10-03: "ok" stood next to six refusals
    // in a row, because "ok" only meant a webhook or the bot was set up). A refused last send turns "ok" into
    // "failing", with Discord's words.
    const log = this.st?.log ?? [];
    const withLast = <V extends { state: string }>(ch: Channel, v: V) => {
      const e = log.find((x) => x.channel === ch);
      const last = e ? { at: e.at, what: e.what, ok: e.ok, ...(e.error ? { error: e.error } : {}) } : null;
      if (v.state === "ok" && last && !last.ok) return { ...v, state: "failing" as const, error: last.error ?? "not taken", last };
      return { ...v, last };
    };
    const [feed, admin, updates] = await Promise.all([one("feed"), adminView(), one("updates")]);
    return { feed: withLast("feed", feed), admin: withLast("admin", admin), updates: withLast("updates", updates), recent: log };
  }

  // ---- §4: one event ------------------------------------------------------------------------------------------------

  /** True when the event is dealt with (posted, or nothing to post); false to try it again at the next round. */
  private async handle(e: FeedEvent, sw: Switches, now: Date): Promise<boolean> {
    const brand = await this.d.store.brand();
    const meta = metaOf(e);
    const name = typeof meta.name === "string" ? meta.name : "";
    const ok = (o: Outcome) => o.ok || !o.retry;
    const at = e.at.getTime();
    switch (e.kind) {
      case "DEATH": {
        if (!sw.deaths || !e.actor || !(await this.d.store.member(e.actor))) return true;
        const base = deathText(e);
        const run = this.deaths.get(e.actor);
        if (run && at - run.lastAt < RUN_MS) {
          run.count++;
          run.lastAt = at;
          if (run.count >= 3 && run.messageId) {
            const r = await this.edit("feed", "deaths", run.messageId, asPlayer(brand, name, e.actor, deathRun(run.base, run.count - 2)));
            if (r.ok) await this.keep({ key: `deaths:${e.actor}`, channel: "feed", messageId: run.messageId, postedAt: new Date(at), editedAt: now });
            return ok(r);
          }
          const r = await this.send(e, 0, "feed", "death", asPlayer(brand, name, e.actor, base));
          if (r.ok && r.id) {
            [run.messageId, run.base] = [r.id, base];
            await this.keep({ key: `deaths:${e.actor}`, channel: "feed", messageId: r.id, postedAt: now, editedAt: null });
          }
          return ok(r);
        }
        this.deaths.set(e.actor, { count: 1, lastAt: at, messageId: "", base });
        return ok(await this.send(e, 0, "feed", "death", asPlayer(brand, name, e.actor, base)));
      }
      case "JOIN": {
        if (!e.actor || meta.inferred) return true;
        this.lastJoin.set(e.actor, at);
        // back within 2 minutes of leaving (a crash, a relog): neither the leave nor this join is posted
        if (this.pendingLeaves.delete(e.actor) || meta.rejoin) return true;
        if (!sw.joins || !(await this.d.store.member(e.actor))) return true;
        return ok(await this.send(e, 0, "feed", "join", asPlayer(brand, name, e.actor, joinText(await this.d.store.online()))));
      }
      case "LEAVE": {
        if (!e.actor || meta.inferred || !sw.joins) return true;
        const joined = this.lastJoin.get(e.actor);
        const short = joined !== undefined ? at - joined < SHORT_MS : typeof meta.minutes === "number" && meta.minutes < 2;
        if (short || !(await this.d.store.member(e.actor))) return true;
        // posted once two minutes have gone by without them coming back
        this.pendingLeaves.set(e.actor, { name, at, due: at + SHORT_MS });
        return true;
      }
      case "ADVANCEMENT": {
        const how = String(meta.how ?? "");
        if (!(how === "challenge" ? sw.challenges || sw.advancements : sw.advancements)) return true;
        if (!e.actor || !(await this.d.store.member(e.actor))) return true;
        // docs/21 §6: a season's titles are taken out of the plain advancement lines; they are season moments
        if (await this.d.store.seasonTitle?.(String(meta.title ?? "")).catch(() => false)) return true;
        return ok(await this.send(e, 0, "feed", "advancement", asPlayer(brand, name, e.actor, advancementText(how, String(meta.title ?? "")))));
      }
      case "SEASON": {
        if (!sw.season) return true;
        return this.season(e, sw, brand, now);
      }
      case "SERVER_START": {
        if (!sw.serverUpDown || this.downPostedAt === null || now.getTime() - this.downPostedAt > BACK_MS) return true;
        this.downPostedAt = null;
        return ok(await this.send(e, 0, "feed", "server back", asServer(brand, backText())));
      }
      case "CRASH": {
        if (!sw.problems) return true;
        const adminTold = this.canAdmin();
        const a = adminTold ? await this.send(e, 0, "admin", "crash", asServer(brand, crashAdminText(e.at, this.d.portal))) : ({ ok: true, id: "" } as Outcome);
        if (!ok(a)) return false;
        return ok(await this.send(e, 1, "feed", "crash", asServer(brand, crashFeedText(adminTold && a.ok))));
      }
      case "ERROR": {
        if (isKnownHarmless(e.message)) return true; // known and harmless: in the event log, not in Discord (events/parse.ts)
        if (!sw.problems || !this.canAdmin()) return true;
        const t = now.getTime();
        const seen = this.problems.get(e.message);
        this.problemTimes = this.problemTimes.filter((x) => t - x < 60 * 60_000);
        // the health watch's own lines (meta.health) are never crowded out by the game's errors of the same hour
        const health = Boolean(metaOf(e).health);
        if ((seen !== undefined && t - seen < PROBLEM_REPEAT_MS) || (!health && this.problemTimes.length >= PROBLEMS_PER_HOUR)) return true;
        const r = await this.send(e, 0, "admin", "problem", asServer(brand, problemText(e.message, 1)));
        if (r.ok) {
          this.problems.set(e.message, t);
          this.problemTimes.push(t);
        }
        return ok(r);
      }
      case "LINK": {
        if (actionOf(e) !== "link.bind" || resultOf(e) !== "OK" || !sw.firstJoin || !e.actor) return true;
        const mc = String(paramsOf(e).mcUsername ?? "");
        const key = `welcome:${e.actor}`;
        if (!mc || (await this.postOf(key))) return true; // once per member
        const r = await this.send(e, 0, "feed", "welcome", asServer(brand, welcomeText(mc)));
        if (r.ok) await this.keep({ key, channel: "feed", messageId: r.id, postedAt: now, editedAt: null });
        return ok(r);
      }
      case "SYNC": {
        if (actionOf(e) !== "modpack.sync" || resultOf(e) !== "OK") return true;
        const change = await this.d.store.packChange();
        if (!change || !change.previous || change.previous === change.version || change.changed <= 0 || Math.abs(change.at.getTime() - at) > 15 * 60_000) return true;
        if (sw.serverUpDown) {
          const r = await this.send(e, 0, "feed", "restart", asServer(brand, restartText(true)));
          if (!ok(r)) return false;
          if (r.ok) this.downPostedAt = now.getTime();
        }
        return sw.pack ? ok(await this.send(e, 1, "feed", "pack", asServer(brand, packText(change.changed)))) : true;
      }
      case "ADMIN_ACTION":
      case "PLAYER_ACTION":
        return this.action(e, sw, brand, now);
      default:
        return true;
    }
  }

  private async action(e: FeedEvent, sw: Switches, brand: Brand, now: Date): Promise<boolean> {
    const action = actionOf(e);
    const p = paramsOf(e);
    const ok = (o: Outcome) => o.ok || !o.retry;
    if (resultOf(e) !== "OK" || !action) return true;
    switch (action) {
      case "server.restart":
      case "server.stop": {
        if (!sw.serverUpDown) return true;
        const r = await this.send(e, 0, "feed", action === "server.stop" ? "server off" : "restart", asServer(brand, action === "server.stop" ? stopText() : restartText(false)));
        if (r.ok) this.downPostedAt = now.getTime();
        return ok(r);
      }
      case "announcement.create": {
        if (!sw.news || typeof p.announcementId !== "string") return true;
        const item = await this.d.store.news(p.announcementId);
        if (!item) return true;
        const pic = item.image ? await this.d.store.picture(item.image) : null;
        const ch = this.twoChannels ? "updates" : "feed";
        return ok(await this.send(e, 0, ch, "news", newsMessage(brand, item.body, pic?.name ?? null), pic ?? undefined, ch === "updates" ? { threadName: postTitle(item.body), tags: this.tags(sw, "News") } : {}));
      }
      case "site.settings": {
        if (!sw.live || p.live !== true || p.was !== false) return true;
        const ch = this.twoChannels ? "updates" : "feed";
        return ok(await this.send(e, 0, ch, "live", asServer(brand, liveText(brand.name, new URL(this.d.portal).host)), undefined, ch === "updates" ? { threadName: LIVE_TITLE, tags: this.tags(sw, "News") } : {}));
      }
      case "poll.open":
      case "vote.open":
        return this.voteOpened(e, action === "poll.open" ? "poll" : "ballot", String(p.pollId ?? p.voteId ?? ""), sw, brand, now);
      case "poll.vote":
      case "ballot.save": {
        const id = String(p.pollId ?? p.voteId ?? "");
        if (sw.votes && id) this.dirtyVotes.add(`${action === "poll.vote" ? "poll" : "ballot"}:${id}`);
        return true;
      }
      case "poll.close":
      case "vote.close":
        return this.voteClosed(e, action === "poll.close" ? "poll" : "ballot", String(p.pollId ?? p.voteId ?? ""), sw, brand, now);
      default:
        return true;
    }
  }

  /** docs/22 §5: game chat to #game-chat, as the player with their head. Linked players only; needs the bot's channel. */
  private async chat(group: FeedEvent[], sw: Switches): Promise<boolean> {
    const e = group[0]!;
    if (!this.d.chatRelay || !sw.chatToDiscord || !sw.chatChannel || !e.actor || !(await this.d.store.member(e.actor))) return true;
    const name = String(metaOf(e).name ?? "");
    const text = group.map((g) => chatText(g)).filter(Boolean).join("\n").slice(0, 1900);
    if (!text) return true;
    const r = await this.send(e, 0, "feed", "chat", asPlayer(await this.d.store.brand(), name, e.actor, text));
    return r.ok || !r.retry;
  }

  // ---- §5: votes (docs/22 §4, §13: a forum post each, the bot's own with buttons when it can) -------------------------

  private tags(sw: Switches, name: string): string[] {
    return this.d.bot && sw.updatesForum ? this.d.bot.tagFor(sw.updatesForum, name) : [];
  }

  /** The bot posts a poll when it is in the server, buttons are on and the forum is picked. */
  private botPosts(sw: Switches, kind: PollView["kind"]): boolean {
    return Boolean(this.d.bot?.inGuild && this.botWould(sw, kind));
  }

  private botWould(sw: Switches, kind: PollView["kind"]): boolean {
    return Boolean(sw.voteButtons && sw.updatesForum && kind === "poll" && this.usable("updates"));
  }

  private async components(kind: PollView["kind"], id: string, closed: boolean): Promise<Component[]> {
    const shape = kind === "poll" && this.d.bot ? await this.d.bot.pollShape(id) : null;
    return shape ? this.d.bot!.components(shape, closed) : [];
  }

  /** The vote's message kept up to date, the way it was posted. */
  private async editVote(post: PostRow, kind: PollView["kind"], v: PollView, brand: Brand, what: string): Promise<{ ok: boolean; retry: boolean }> {
    const msg = voteMessage(brand, v, this.d.portal);
    if (post.via === "bot" && this.d.bot && post.threadId) {
      const r = await this.d.bot.edit(post.threadId, post.messageId, { embeds: msg.embeds, components: await this.components(kind, v.id, v.status !== "OPEN"), allowed_mentions: msg.allowed_mentions });
      this.record({ channel: post.channel, what, ok: r.ok, ...(r.error ? { error: r.error } : {}) });
      return r;
    }
    const r = await this.edit(post.channel, what, post.messageId, msg, post.threadId);
    return { ok: r.ok, retry: !r.ok && r.retry };
  }

  /** Open a vote's post: the bot's (buttons) or the webhook's (a link to the site). */
  private async openVote(e: FeedEvent | null, kind: PollView["kind"], v: PollView, sw: Switches, brand: Brand, now: Date): Promise<Outcome & { row?: PostRow }> {
    const key = `${kind}:${v.id}`;
    const msg = voteMessage(brand, v, this.d.portal);
    // the bot is still connecting: wait for it, or the vote is the webhook's post without buttons for good
    if (this.botSoon() && this.botWould(sw, kind)) return { ok: false, retry: true };
    if (this.botPosts(sw, kind)) {
      const r = await this.d.bot!.createPost(sw.updatesForum, v.title, { embeds: msg.embeds, components: await this.components(kind, v.id, false), allowed_mentions: msg.allowed_mentions }, "Vote");
      this.record({ channel: "updates", what: `${kind} opened`, ok: r.ok, ...(r.ok ? {} : { error: r.error }) });
      if (r.ok) {
        const row: PostRow = { key, channel: "updates", messageId: r.messageId, postedAt: now, editedAt: null, via: "bot", threadId: r.threadId };
        await this.keep(row);
        return { ok: true, id: r.messageId, channelId: r.threadId, row };
      }
      // the bot could not post: the webhook's post, without buttons
    }
    const ch: Channel = this.twoChannels ? "updates" : "feed";
    const r = await this.send(e, 0, ch, `${kind} opened`, msg, undefined, ch === "updates" ? { threadName: v.title, tags: this.tags(sw, "Vote") } : {});
    if (!r.ok) return r;
    const row: PostRow = { key, channel: ch, messageId: r.id, postedAt: now, editedAt: null, via: "webhook", threadId: ch === "updates" ? r.channelId || null : null };
    await this.keep(row);
    return { ...r, row };
  }

  /** A reply in the vote's post (the reminder, the result line). A post deleted by hand is made again, once. */
  private async replyToVote(e: FeedEvent | null, n: number, kind: PollView["kind"], id: string, what: string, msg: Message, brand: Brand, sw: Switches, now: Date): Promise<Outcome> {
    const post = await this.postOf(`${kind}:${id}`);
    const ch: Channel = post?.channel ?? (this.twoChannels ? "updates" : "feed");
    if (!post && ch === "updates") {
      // no post of this vote (it was opened while the feed was off or paused), and a forum takes no line without one:
      // an open vote gets its post now and the line goes in it; a result is a post of its own, named after the vote
      const v = await this.d.store.vote(kind, id);
      if (!v) return { ok: false, retry: false };
      if (v.status !== "OPEN") return this.send(e, n, ch, what, msg, undefined, { threadName: v.title, tags: this.tags(sw, "Vote") });
      const opened = await this.openVote(null, kind, v, sw, brand, now);
      if (!opened.ok) return { ok: false, retry: opened.retry };
      if (!opened.row?.threadId) return { ok: false, retry: false };
      return this.send(e, n, ch, what, msg, undefined, { threadId: opened.row.threadId });
    }
    const r = await this.send(e, n, ch, what, msg, undefined, post?.threadId ? { threadId: post.threadId } : {});
    if (r.ok || !r.gone) return r;
    const v = await this.d.store.vote(kind, id);
    if (!v) return { ok: false, retry: false };
    const again = await this.openVote(null, kind, v, sw, brand, now);
    if (!again.ok) return { ok: false, retry: again.retry }; // Discord is away: the line is tried again, in the post made then
    if (!again.row?.threadId) return { ok: false, retry: false };
    return this.send(e, n, ch, what, msg, undefined, { threadId: again.row.threadId });
  }

  private async voteOpened(e: FeedEvent, kind: PollView["kind"], id: string, sw: Switches, brand: Brand, now: Date): Promise<boolean> {
    if (!sw.votes || !id) return true;
    if (await this.postOf(`${kind}:${id}`)) return true;
    const v = await this.d.store.vote(kind, id);
    if (!v || v.status !== "OPEN") return true; // closed or deleted since: nothing
    const r = await this.openVote(e, kind, v, sw, brand, now);
    return r.ok || !r.retry;
  }

  private async voteClosed(e: FeedEvent, kind: PollView["kind"], id: string, sw: Switches, brand: Brand, now: Date): Promise<boolean> {
    if (!sw.votes || !id) return true;
    const v = await this.d.store.vote(kind, id);
    if (!v) return true;
    const key = `${kind}:${id}`;
    this.dirtyVotes.delete(key);
    const post = await this.postOf(key);
    if (post?.messageId && !(this.partial?.id === e.id && this.partial.done.has(0))) {
      // the first message turns into the result; the buttons go
      const r = await this.editVote(post, kind, v, brand, `${kind} result`);
      if (r.ok) await this.keep({ ...post, editedAt: now });
      if (!r.ok && r.retry) return false;
      if (this.partial?.id !== e.id) this.partial = { id: e.id, done: new Set() };
      this.partial.done.add(0);
    }
    const r = await this.replyToVote(e, 1, kind, id, `${kind} closed`, asServer(brand, voteClosedText(v, this.d.portal)), brand, sw, now);
    return r.ok || !r.retry;
  }

  // ---- docs/21 §6, docs/22 §13: season moments, a forum post per boss, per trial and per season ----------------------

  /**
   * One season moment: its post is made the first time something happens to that boss, trial or season, and the
   * moment is a reply in it. Without the forum's webhook nothing is posted (§13: no falling back to #game-chat).
   */
  private async season(e: FeedEvent, sw: Switches, brand: Brand, now: Date): Promise<boolean> {
    if (!this.usable("updates")) return true;
    const info = await this.d.store.season?.(String(metaOf(e).season ?? "")).catch(() => null);
    if (!info) return true;
    const post = seasonPost(e, info, this.d.portal);
    if (!post) return true;
    const open = async (n: number): Promise<Outcome> => {
      const r = await this.send(e, n, "updates", `${post.tag.toLowerCase()} post`, asServer(brand, post.opener), undefined, { threadName: post.title, tags: this.tags(sw, post.tag) });
      if (r.ok && r.channelId) await this.keep({ key: post.key, channel: "updates", messageId: r.id, postedAt: now, editedAt: null, via: "webhook", threadId: r.channelId });
      return r;
    };
    let threadId = (await this.postOf(post.key))?.threadId ?? null;
    if (!threadId) {
      const r = await open(0);
      if (!r.ok) return !r.retry;
      threadId = r.channelId || ((await this.postOf(post.key))?.threadId ?? null);
      if (!threadId) return true; // Discord took it but gave no post id: not a forum
    }
    const text = seasonReply(e, info, this.d.portal);
    if (!text) return true;
    const r = await this.send(e, 1, "updates", String(metaOf(e).what ?? "season"), asServer(brand, text), undefined, { threadId });
    if (r.ok || !r.gone) return r.ok || !r.retry;
    // the post was deleted by hand in Discord: made again once, and the reply goes into the new one
    const again = await open(2);
    if (!again.ok || !again.channelId) return !again.ok && again.retry ? false : true;
    const second = await this.send(e, 3, "updates", String(metaOf(e).what ?? "season"), asServer(brand, text), undefined, { threadId: again.channelId });
    return second.ok || !second.retry;
  }

  // ---- the change log (Alex, 2026-10-04): one forum post, a reply per deploy ----------------------------------------------

  private changeLogAt = 0;
  private changeLogDone = false;

  /**
   * Every entry of changelog.ts that has not been posted yet becomes a reply in the one post "Change log" in
   * season-updates, oldest first. The post is made the first time; one deleted by hand is made again. Looked at once
   * a minute until everything is posted, so in practice once after each deploy. Without the forum's webhook: nothing.
   * An entry Discord refuses for good is marked as posted and skipped, so it cannot hold up the ones after it.
   */
  private async changeLog(sw: Switches, brand: Brand, now: Date): Promise<void> {
    const changes = this.d.changes ?? [];
    if (this.changeLogDone || changes.length === 0 || now.getTime() - this.changeLogAt < 60_000) return;
    this.changeLogAt = now.getTime();
    if (!this.usable("updates")) return;
    const open = async (): Promise<string | null> => {
      const r = await this.send(null, 0, "updates", "change log post", asServer(brand, CHANGELOG_OPENER), undefined, { threadName: CHANGELOG_TITLE, tags: this.tags(sw, "News") });
      if (!r.ok || !r.channelId) return null;
      await this.keep({ key: "changelog", channel: "updates", messageId: r.id, postedAt: now, editedAt: null, via: "webhook", threadId: r.channelId });
      return r.channelId;
    };
    let threadId = (await this.postOf("changelog"))?.threadId ?? null;
    for (const c of changes) {
      const key = `changelog:${c.id}`;
      if (await this.postOf(key)) continue;
      threadId ??= await open();
      if (!threadId) return; // not taken, or not a forum: looked at again in a minute
      let r = await this.send(null, 0, "updates", "change log", asServer(brand, changeText(c)), undefined, { threadId });
      if (!r.ok && r.gone) {
        // the post was deleted by hand in Discord: made again, and the entry goes into the new one
        threadId = await open();
        if (!threadId) return;
        r = await this.send(null, 0, "updates", "change log", asServer(brand, changeText(c)), undefined, { threadId });
      }
      if (!r.ok) {
        // Discord is away, the post has gone again, or the webhook itself was refused: looked at again in a minute
        if (r.retry || r.gone || !this.usable("updates")) return;
        // Discord will never take this entry as it is (400): marked, said once, and the later entries are not held up
        this.d.log({ id: c.id, error: this.st?.log[0]?.error }, "discord change log: Discord refused this entry; it is skipped");
      }
      await this.keep({ key, channel: "updates", messageId: r.ok ? r.id : "", postedAt: now, editedAt: null, via: "webhook", threadId });
    }
    this.changeLogDone = true;
  }

  // ---- what happens with time, not with an event ---------------------------------------------------------------------

  private async duties(sw: Switches) {
    const now = this.now();
    const t = now.getTime();
    const brand = await this.d.store.brand();
    // rows the database would not take earlier
    for (const row of [...this.unsaved.values()]) await this.keep(row);
    // leaves that nobody came back from
    for (const [uuid, l] of [...this.pendingLeaves]) {
      if (l.due > t) continue;
      this.pendingLeaves.delete(uuid);
      if (t - l.at > SHORT_MS + 10 * 60_000) continue; // stale: api was busy or away
      const r = await this.send(null, 0, "feed", "leave", asPlayer(brand, l.name, uuid, leaveText(await this.d.store.online())));
      if (!r.ok && r.retry) this.pendingLeaves.set(uuid, l);
    }
    for (const [uuid, run] of [...this.deaths]) if (t - run.lastAt >= RUN_MS) this.deaths.delete(uuid);
    for (const [uuid, at] of [...this.lastJoin]) if (t - at > 24 * 60 * 60_000) this.lastJoin.delete(uuid);
    await this.changeLog(sw, brand, now);
    if (!sw.votes) return;
    // a vote's count, at most once a minute
    for (const key of [...this.dirtyVotes]) {
      const post = await this.postOf(key);
      if (!post?.messageId) {
        this.dirtyVotes.delete(key);
        continue;
      }
      if (t - (post.editedAt ?? post.postedAt).getTime() < EDIT_GAP_MS) continue;
      const [kind, id] = key.split(":") as [PollView["kind"], string];
      const v = await this.d.store.vote(kind, id);
      this.dirtyVotes.delete(key);
      if (!v || v.status !== "OPEN") continue; // the close edits it
      const r = await this.editVote(post, kind, v, brand, `${kind} count`);
      if (r.ok) await this.keep({ ...post, editedAt: now });
      else if (r.retry) this.dirtyVotes.add(key);
    }
    // the reminder 24 hours before a vote closes
    if (t - this.remindedAt < 60_000) return;
    this.remindedAt = t;
    for (const v of await this.d.store.remindable(now)) {
      const key = `remind:${v.kind}:${v.id}`;
      if (await this.postOf(key)) continue;
      const missing = await this.d.store.unvoted(v.kind, v.id);
      if (missing.discordIds.length + missing.others === 0) {
        await this.keep({ key, channel: "feed", messageId: "", postedAt: now, editedAt: null }); // everybody has
        continue;
      }
      const buttons = (await this.postOf(`${v.kind}:${v.id}`))?.via === "bot";
      const r = await this.replyToVote(null, 0, v.kind, v.id, "reminder", reminderMessage(brand, v, missing, sw.mentionUnvoted, now, buttons), brand, sw, now);
      if (r.ok || !r.retry) await this.keep({ key, channel: "feed", messageId: r.ok ? r.id : "", postedAt: now, editedAt: null });
    }
  }
}
