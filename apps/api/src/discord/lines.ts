// docs/21 §4–§5: what the feed says. Every word that goes to Discord is in this file and nowhere else; it is pure (no
// database, no clock of its own), so each line is tested against a real Event row.
import type { Section } from "../shared/settings.js";
import { DONT_MIND } from "../shared/polls.js";
import { SUPPRESS_EMBEDS, type Message } from "./webhook.js";

export type Switches = Section<"discord">;
export type Brand = { name: string; avatar: string | null };
export type Channel = "feed" | "admin" | "updates"; // updates: the forum season-updates (docs/22 §13)

/** An `Event` row as the Announcer reads it. */
export type FeedEvent = { id: bigint; at: Date; kind: string; actor: string | null; message: string; meta: unknown };

/** How long a line may wait: 10 minutes, or 24 hours for the kinds marked *keep* (§3). */
export const STALE_MS = 10 * 60_000;
export const KEEP_MS = 24 * 60 * 60_000;
export const CHAT_STALE_MS = 2 * 60_000;
const KEEP_ACTIONS = new Set(["poll.open", "poll.close", "poll.vote", "vote.open", "vote.close", "ballot.save", "announcement.create", "site.settings"]);

export function actionOf(e: Pick<FeedEvent, "meta">): string | null {
  const a = (e.meta as { action?: unknown } | null)?.action;
  return typeof a === "string" ? a : null;
}
export function paramsOf(e: Pick<FeedEvent, "meta">): Record<string, unknown> {
  const p = (e.meta as { params?: unknown } | null)?.params;
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
}
export function resultOf(e: Pick<FeedEvent, "meta">): string | null {
  const r = (e.meta as { result?: unknown } | null)?.result;
  return typeof r === "string" ? r : null;
}
export function metaOf(e: Pick<FeedEvent, "meta">): Record<string, unknown> {
  return e.meta && typeof e.meta === "object" && !Array.isArray(e.meta) ? (e.meta as Record<string, unknown>) : {};
}

/** Kept kinds wait 24 hours; the rest are dropped after 10 minutes (§2.7: old news is not posted). */
export function isStale(e: Pick<FeedEvent, "at" | "kind" | "meta">, now: Date): boolean {
  const age = now.getTime() - e.at.getTime();
  if (e.kind === "CHAT") return age > CHAT_STALE_MS; // docs/22 §5: old chat is not replayed
  const action = actionOf(e);
  const keep = e.kind === "SEASON" || (action !== null && KEEP_ACTIONS.has(action));
  return age > (keep ? KEEP_MS : STALE_MS);
}

// ---- text from the game ---------------------------------------------------------------------------------------------

/** Names and death texts come from the game: Markdown is escaped, `@` cannot mention, `<…>` cannot be a mention tag. */
export function escapeText(s: string): string {
  return s
    .replace(/[\\*_~`|>#[\]()<:-]/g, (c) => `\\${c}`)
    .replace(/@/g, "@​")
    .replace(/\r?\n/g, " ");
}

const NO_MENTIONS = { parse: [] as never[] };

export function headUrl(uuid: string): string {
  return `https://mc-heads.net/avatar/${encodeURIComponent(uuid.replace(/-/g, ""))}/64`;
}

/** A Discord webhook name may not contain "discord" or "clyde", nor @ # : or ```. Minecraft names rarely do. */
function senderName(name: string): string | null {
  return /^[A-Za-z0-9_]{1,32}$/.test(name) && !/discord|clyde/i.test(name) ? name : null;
}

/** A player line: sent as the player, with their head. Falls back to the server's name with the player's in bold. */
export function asPlayer(brand: Brand, name: string, uuid: string, text: string): Message {
  const sender = senderName(name);
  if (sender) return { content: text, username: sender, avatar_url: headUrl(uuid), flags: SUPPRESS_EMBEDS, allowed_mentions: NO_MENTIONS };
  return { ...asServer(brand, `**${escapeText(name)}** ${text}`) };
}

export function asServer(brand: Brand, content: string): Message {
  return { content, username: brand.name.slice(0, 80), ...(brand.avatar ? { avatar_url: brand.avatar } : {}), flags: SUPPRESS_EMBEDS, allowed_mentions: NO_MENTIONS };
}

function embedMsg(brand: Brand, embed: NonNullable<Message["embeds"]>[number], content?: string): Message {
  return { ...(content ? { content } : {}), embeds: [embed], username: brand.name.slice(0, 80), ...(brand.avatar ? { avatar_url: brand.avatar } : {}), allowed_mentions: NO_MENTIONS };
}

/** Every embed's edge is the site's Copper (docs/23 §3), whatever the branding row once held as an accent. */
export const COPPER = 0xe8833a;

// ---- times, in the UK ------------------------------------------------------------------------------------------------

const UK = "Europe/London";
/** "21:04" */
export function ukTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: UK, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}
/** "Friday 9 Oct, 20:00 UK" */
export function ukWhen(d: Date): string {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: UK, weekday: "long", day: "numeric", month: "short" }).formatToParts(d);
  const get = (t: string) => day.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}, ${ukTime(d)} UK`;
}

// ---- §4: one line per event -----------------------------------------------------------------------------------------

/** "was blown up by Creeper": the game's sentence without the name in front (the line is sent as the player). */
export function deathText(e: Pick<FeedEvent, "message" | "meta">): string {
  const name = String(metaOf(e).name ?? "");
  const text = name && e.message.startsWith(`${name} `) ? e.message.slice(name.length + 1) : e.message;
  return escapeText(text.trim()).slice(0, 400);
}
/** "…, and 2 more times since" on the player's previous death line (§4, runs of deaths). */
export function deathRun(base: string, more: number): string {
  return `${base} · and ${more} more ${more === 1 ? "time" : "times"} since`;
}

export const joinText = (online: number) => `joined · ${online} online`;
export const leaveText = (online: number) => `left · ${online} online`;

/** Challenges always (switch Challenges); advancements and goals only with All advancements. */
export function advancementText(how: string, title: string): string {
  const t = `**${escapeText(title)}**`;
  return how === "challenge" ? `completed the challenge ${t}` : how === "goal" ? `reached the goal ${t}` : `made the advancement ${t}`;
}

/** docs/22 §5: what a player said, without the "<name> " the event line starts with. */
export function chatText(e: Pick<FeedEvent, "message" | "meta">): string {
  const name = String(metaOf(e).name ?? "");
  const text = name && e.message.startsWith(`<${name}> `) ? e.message.slice(name.length + 3) : e.message;
  return escapeText(text.trim());
}

/** A forum post's title: plain text, one line, at most 100 characters. */
export function postTitle(s: string): string {
  const line = (s.split(/\r?\n/).find((l) => l.trim()) ?? "").replace(/[*_~`|>#[\]()]/g, "").replace(/\s+/g, " ").trim();
  return (line.length > 100 ? `${line.slice(0, 99)}…` : line) || "News";
}
export const LIVE_TITLE = "We're live";

export const welcomeText = (name: string) => `**${escapeText(name)}** is in. Welcome!`;
export const liveText = (brandName: string, host: string) => `**${escapeText(brandName)} is open.** Press Play at ${host}`;
export const restartText = (forUpdate: boolean) => (forUpdate ? "The server is restarting for an update. Back in about a minute." : "The server is restarting. Back in about a minute.");
export const stopText = () => "The server has been switched off for now.";
export const backText = () => "The server is back.";
export const packText = (changed: number) => `New pack: ${changed} ${changed === 1 ? "mod" : "mods"} changed. The app updates it when you press Play.`;
export const crashAdminText = (at: Date, portal: string) => `The server crashed at ${ukTime(at)}. Open Admin → Server: ${portal}/admin/server`;
export const crashFeedText = (adminTold: boolean) => (adminTold ? "The server fell over. Alex has been told." : "The server fell over.");
export const problemText = (message: string, count: number) => `Problem: ${escapeText(message).slice(0, 400)}${count > 1 ? ` (×${count})` : ""}`;
export const refusedText = (channel: Channel) => `Discord feed: the webhook was refused${channel === "admin" ? " (admin channel)" : ""}`;
export const TEST_TEXT = "This is a test from Deepslate Works. If you can read it, the feed works.";

/** A news item: its text and picture, as the server. The text is the admin's own, so it is not escaped (no one is pinged). */
export function newsMessage(brand: Brand, body: string, picture: string | null): Message {
  return embedMsg(brand, { description: body.slice(0, 4000), color: COPPER, ...(picture ? { image: { url: `attachment://${picture}` } } : {}) });
}

// ---- §5: votes -------------------------------------------------------------------------------------------------------

export type PollView = {
  kind: "poll" | "ballot";
  id: string;
  title: string;
  options: string[]; // as shown; a ballot lists none (it is the mod list)
  closesAt: Date | null;
  mustVote: boolean;
  voters: number;
  members: number;
  status: "OPEN" | "CLOSED";
  result?: Array<{ text: string; votes: number }>; // polls, once closed, in the poll's order with "I don't mind" last
  winners?: string[];
  modsIn?: number; // the mod ballot, once closed
};

function votedLine(v: PollView): string {
  return `${v.voters} of ${v.members} ${v.voters === 1 && v.members === 1 ? "has" : "have"} voted`;
}

function bar(votes: number, voters: number): string {
  const n = voters ? Math.round((votes / voters) * 10) : 0;
  return `${"█".repeat(n)}${"░".repeat(10 - n)}`;
}

/** The one message per vote, kept up to date: open (count only, never who or what), then closed with the result. */
export function voteMessage(brand: Brand, v: PollView, portal: string): Message {
  const link = v.kind === "ballot" ? `${portal}/vote` : `${portal}/votes`;
  const lines: string[] = [];
  if (v.status === "OPEN") {
    if (v.kind === "poll") for (const o of v.options) lines.push(`• ${escapeText(o)}`);
    else lines.push("Pick the mods you want for the season.");
    lines.push("");
    lines.push(v.closesAt ? `Closes ${ukWhen(v.closesAt)}` : "Open until an admin closes it");
    if (v.mustVote) lines.push("You need to vote before you can play");
    lines.push(`[Vote](${link})`);
  } else if (v.kind === "poll" && v.result) {
    const winners = new Set(v.winners ?? []);
    const rows = [...v.result.filter((r) => r.text !== DONT_MIND.text), ...v.result.filter((r) => r.text === DONT_MIND.text)];
    for (const r of rows) {
      const label = `${escapeText(r.text)} · ${r.votes}`;
      lines.push(`${bar(r.votes, v.voters)} ${winners.has(r.text) ? `**${label}**` : label}`);
    }
    lines.push("", "Closed");
  } else {
    lines.push(`${v.modsIn ?? 0} ${v.modsIn === 1 ? "mod is" : "mods are"} in.`, `[See the pack](${portal}/pack)`, "", "Closed");
  }
  return embedMsg(brand, {
    title: v.title.slice(0, 250),
    description: lines.join("\n").slice(0, 4000),
    url: link,
    color: COPPER,
    footer: { text: votedLine(v) },
  });
}

/** The new line when a vote closes, so the channel sees it. */
export function voteClosedText(v: PollView, portal: string): string {
  const title = escapeText(v.title);
  if (v.kind === "ballot") return `**${title} is closed** · ${v.modsIn ?? 0} ${v.modsIn === 1 ? "mod is" : "mods are"} in. ${portal}/pack`;
  const w = (v.winners ?? []).map(escapeText);
  const top = v.result?.find((r) => r.text === v.winners?.[0])?.votes ?? 0;
  if (w.length === 0) return `**The vote is closed: ${title}** · no clear answer (${v.voters} of ${v.members} voted)`;
  if (w.length === 1) return `**The vote is closed: ${title}** · ${w[0]} won with ${top} of ${v.voters}`;
  return `**The vote is closed: ${title}** · a tie between ${w.slice(0, -1).join(", ")} and ${w.at(-1)}, ${top} each`;
}

/**
 * The reminder 24 hours before a vote closes. With mentions on, the members with a Discord account who have not voted
 * are named (and only they can be pinged); the others are counted.
 */
export function reminderMessage(brand: Brand, v: Pick<PollView, "title" | "closesAt">, missing: { discordIds: string[]; others: number }, mention: boolean, now: Date, buttons = false): Message {
  const when = v.closesAt ? closesIn(v.closesAt, now) : "soon";
  const total = missing.discordIds.length + missing.others;
  const head = `The vote **${escapeText(v.title)}** closes ${when}.${buttons ? " Vote with the buttons above." : ""}`;
  if (!mention || missing.discordIds.length === 0) return asServer(brand, `${head} ${total} ${total === 1 ? "person" : "people"} still to vote.`);
  const ids = missing.discordIds.slice(0, 50);
  const extra = total - ids.length;
  const content = `${head} Still to vote: ${ids.map((id) => `<@${id}>`).join(" ")}${extra > 0 ? ` and ${extra} more` : ""}`;
  return { ...asServer(brand, content), allowed_mentions: { parse: [], users: ids } };
}

function closesIn(closesAt: Date, now: Date): string {
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: UK, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60_000);
  const day = fmt(closesAt) === fmt(now) ? "today" : fmt(closesAt) === fmt(tomorrow) ? "tomorrow" : `on ${ukWhen(closesAt).replace(/, .*$/, "")}`;
  return `${day} at ${ukTime(closesAt)}`;
}

// ---- docs/21 §6, docs/22 §13: season moments. Each boss, each trial and the season itself is one post in the forum
// season-updates; what happens to it is a reply in that post. The recorder's SEASON event says what (meta.what).

/** What the announcer needs of a season's file. */
export type SeasonInfo = {
  id: string; name: string;
  bosses: Array<{ id: string; title: string; tier: number; points: number; where: string; hint: string }>;
  trials: Array<{ id: string; title: string; points: number; hint: string }>;
};

export type SeasonPost = { key: string; title: string; tag: "Boss" | "Trial" | "Season"; opener: string };

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const bold = (s: string) => `**${escapeText(s)}**`;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The post a season moment belongs to, with its first message; null when the season's file does not have the boss or trial. */
export function seasonPost(e: Pick<FeedEvent, "meta">, s: SeasonInfo, portal: string): SeasonPost | null {
  const m = metaOf(e);
  const what = String(m.what ?? "");
  const id = String(m.id ?? "");
  if (what === "boss" || what === "wake" || what === "boss_open") {
    const b = s.bosses.find((x) => x.id === id);
    if (!b) return null;
    const about = [b.where, b.hint].filter(Boolean).map(escapeText).join(". ");
    return { key: `boss:${s.id}:${b.id}`, title: `${b.title} · ${s.name}`.slice(0, 100), tag: "Boss", opener: `${bold(b.title)} · tier ${b.tier} · ${b.points} points, twice for the first on the server${about ? `\n${about}` : ""}` };
  }
  if (what === "trial" || what === "trial_open") {
    const t = s.trials.find((x) => x.id === id);
    if (!t) return null;
    return { key: `trial:${s.id}:${t.id}`, title: `Trial: ${t.title} · ${s.name}`.slice(0, 100), tag: "Trial", opener: `${bold(`Trial: ${t.title}`)} · ${t.points} points${t.hint ? `\n${escapeText(t.hint)}` : ""}` };
  }
  return { key: `season:${s.id}`, title: s.name.slice(0, 100), tag: "Season", opener: `${bold(s.name)}\nThe ladder, the trials and the scoreboard: ${portal}/season` };
}

/** The reply a season moment is, in its post. Null: nothing to say beyond the post itself (a trial or boss opening). */
export function seasonReply(e: Pick<FeedEvent, "message" | "meta">, s: SeasonInfo, portal: string): string | null {
  const m = metaOf(e);
  const what = String(m.what ?? "");
  const names = strings(m.names).map(escapeText);
  const title = escapeText(String(m.title ?? ""));
  const item = what === "boss" ? s.bosses.find((x) => x.id === m.id) : what === "trial" ? s.trials.find((x) => x.id === m.id) : undefined;
  const early = m.early ? " Found early." : "";
  switch (what) {
    case "boss_open":
    case "trial_open":
      return null; // the post's first message is the news
    case "wake":
      return `**${title} has awoken.**${m.by ? ` ${escapeText(String(m.by))} is in the fight.` : ""}`;
    case "boss":
      return m.first ? `**${title} has fallen**, first on the server, to ${list(names)}. ${(item?.points ?? 0) * 2} points each.${early}` : `${list(names)} beat ${title}.${early}`;
    case "trial":
      return m.first ? `**${list(names)}** ${names.length === 1 ? "is" : "are"} first through **${title}**. ${(item?.points ?? 0) * 2} points.${early}` : `${list(names)} finished ${title}.${early}`;
    case "goal": {
      const pc = Number(m.percent ?? 0);
      return `Server goal: ${Number(m.count ?? 0)} of ${Number(m.target ?? 0)} boss kills.${pc >= 100 ? " Done!" : pc === 50 ? " Half way." : ""}`;
    }
    case "leader":
      return `${bold(String(m.name ?? ""))} takes the lead with ${Number(m.points ?? 0)} points`;
    case "started":
      return `**${escapeText(s.name)} has begun.** A trial every week: ${portal}/season`;
    case "ended":
      return `**${escapeText(e.message)}**\nThe result is kept in the hall of fame: ${portal}/season?tab=hall`;
    default:
      return escapeText(e.message); // announced, a week to go, a day to go, the finale
  }
}
