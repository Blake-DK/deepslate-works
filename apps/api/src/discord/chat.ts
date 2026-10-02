// docs/22 §5, Discord → game: a message in #game-chat becomes one chat line in the game through the action
// chat.fromDiscord. Pure helpers (tested): the cleaner, the message's text as the game shows it, the rate limit.

const MAX_TEXT = 256;
const MAX_NAME = 32;
// control and format characters, line and paragraph separators, and Minecraft's colour sign
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}§]/gu;

/** One line: breaks become spaces, control characters and § go, at most 256 characters with "…" after that. */
export function discordChatText(s: string): string {
  const one = s.replace(/\r\n|\r|\n|\u2028|\u2029/g, " ").replace(UNSAFE, "").replace(/\s+/g, " ").trim();
  return one.length > MAX_TEXT ? `${one.slice(0, MAX_TEXT).trimEnd()}…` : one;
}

export function discordChatName(s: string): string {
  return s.replace(UNSAFE, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
}

export type DiscordMessage = {
  id: string;
  channel_id: string;
  guild_id?: string;
  content?: string;
  webhook_id?: string;
  type?: number;
  author?: { id: string; username: string; global_name?: string | null; bot?: boolean };
  member?: { nick?: string | null };
  mentions?: Array<{ id: string; username: string; global_name?: string | null; member?: { nick?: string | null } }>;
  attachments?: Array<{ content_type?: string; filename?: string }>;
  sticker_items?: Array<{ name: string }>;
};

/** From a person, not a bot or a webhook (which is also what stops our own lines coming back), plain or a reply. */
export function fromPerson(m: DiscordMessage): boolean {
  return Boolean(m.author) && !m.author!.bot && !m.webhook_id && (m.type === undefined || m.type === 0 || m.type === 19);
}

/** The text as the game shows it: mentions as names, custom emoji as :name:, pictures and files as words. */
export function gameText(m: DiscordMessage, channelName: (id: string) => string | null): string {
  const users = new Map((m.mentions ?? []).map((u) => [u.id, u.member?.nick || u.global_name || u.username]));
  let t = (m.content ?? "")
    .replace(/<@!?(\d+)>/g, (_x, id: string) => `@${users.get(id) ?? "someone"}`)
    .replace(/<@&(\d+)>/g, "@role")
    .replace(/<#(\d+)>/g, (_x, id: string) => `#${channelName(id) ?? "channel"}`)
    .replace(/<a?:(\w{1,32}):\d+>/g, ":$1:")
    .replace(/<t:(\d+)(?::\w)?>/g, (_x, t: string) => new Date(Number(t) * 1000).toISOString().slice(0, 16).replace("T", " "));
  const extra: string[] = [];
  for (const a of m.attachments ?? []) extra.push(a.content_type?.startsWith("image/") ? "[picture]" : "[file]");
  for (const s of m.sticker_items ?? []) extra.push(`[${s.name}]`);
  t = [t, ...extra].filter(Boolean).join(" ");
  return discordChatText(t);
}

/** At most 1 line a second per person and 5 a second in all; what is over is dropped (and gets a 🐌). */
export class ChatLimit {
  private last = new Map<string, number>();
  private recent: number[] = [];
  constructor(private readonly now: () => number = Date.now) {}
  take(person: string): boolean {
    const t = this.now();
    this.recent = this.recent.filter((x) => t - x < 1000);
    const mine = this.last.get(person);
    if ((mine !== undefined && t - mine < 1000) || this.recent.length >= 5) return false;
    this.last.set(person, t);
    this.recent.push(t);
    if (this.last.size > 500) for (const [k, v] of this.last) if (t - v > 60_000) this.last.delete(k);
    return true;
  }
}
