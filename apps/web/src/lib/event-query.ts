import { EVENT_KINDS, PLAYER_KINDS, type EventKind } from "@/shared/events";

// docs/16 §4: the filters of the event log live in the URL, so a filtered view can be linked.
// Pure: turns the query string into a filter and the filter into a Prisma `where`.

export type EventFilter = { kinds: EventKind[]; player: string | null; from: Date | null; to: Date | null; text: string | null; before: bigint | null };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => x.split(","));

function day(s: string, endOfDay: boolean): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function readFilter(q: Record<string, string | string[] | undefined>, admin: boolean): EventFilter {
  const allowed: readonly EventKind[] = admin ? EVENT_KINDS : PLAYER_KINDS;
  const kinds = [...new Set(many(q.kind).map((k) => k.trim().toUpperCase()))].filter((k): k is EventKind => (allowed as readonly string[]).includes(k));
  const player = one(q.player).trim().slice(0, 64);
  const text = one(q.q).trim().slice(0, 100);
  const before = /^\d{1,18}$/.test(one(q.before)) ? BigInt(one(q.before)) : null;
  return { kinds, player: player || null, from: day(one(q.from), false), to: day(one(q.to), true), text: text || null, before };
}

export function filterToQuery(f: EventFilter, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (f.kinds.length) p.set("kind", f.kinds.join(","));
  if (f.player) p.set("player", f.player);
  if (f.from) p.set("from", f.from.toISOString().slice(0, 10));
  if (f.to) p.set("to", f.to.toISOString().slice(0, 10));
  if (f.text) p.set("q", f.text);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

// docs/29 §3: the chips of the Activity page. A group is only a set of kinds; the URL stays `kind=` (rule 8).
// Every kind in EVENT_KINDS is in exactly one group; the first four are exactly PLAYER_KINDS.
export type EventGroup = { key: string; label: string; words: string; kinds: readonly EventKind[]; admin: boolean };

export const EVENT_GROUPS: readonly EventGroup[] = [
  { key: "joins", label: "Joins and leaves", words: "joins and leaves", kinds: ["JOIN", "LEAVE"], admin: false },
  { key: "deaths", label: "Deaths", words: "deaths", kinds: ["DEATH"], admin: false },
  { key: "advancements", label: "Advancements", words: "advancements", kinds: ["ADVANCEMENT"], admin: false },
  { key: "server", label: "Server", words: "server starts and stops", kinds: ["SERVER_START", "SERVER_STOP"], admin: false },
  { key: "chat", label: "Chat", words: "chat", kinds: ["CHAT"], admin: true },
  { key: "problems", label: "Problems", words: "problems", kinds: ["CRASH", "WARN", "ERROR"], admin: true },
  { key: "admin", label: "Admin actions", words: "admin actions", kinds: ["ADMIN_ACTION"], admin: true },
  { key: "player", label: "Player actions", words: "player actions", kinds: ["PLAYER_ACTION"], admin: true },
  { key: "joining", label: "Joining", words: "joining", kinds: ["LINK", "JOIN_BLOCKED", "REVOKE"], admin: true },
  { key: "pack", label: "Pack and installs", words: "pack and installs", kinds: ["SYNC", "INSTALL", "DOWNLOAD"], admin: true },
  { key: "backups", label: "Backups", words: "backups", kinds: ["BACKUP"], admin: true },
];

/** The words for one kind, for the "Showing …" line when only part of a group is in the filter (`?kind=JOIN`). */
const KIND_WORDS: Record<EventKind, string> = {
  JOIN: "joins", LEAVE: "leaves", DEATH: "deaths", CHAT: "chat", ADVANCEMENT: "advancements",
  SERVER_START: "server starts", SERVER_STOP: "server stops", CRASH: "crashes", WARN: "warnings", ERROR: "errors",
  ADMIN_ACTION: "admin actions", PLAYER_ACTION: "player actions", LINK: "links", REVOKE: "removals", SYNC: "mod syncs", BACKUP: "backups", INSTALL: "installs", JOIN_BLOCKED: "held at the door", DOWNLOAD: "downloads",
};

export function groupsFor(admin: boolean): EventGroup[] {
  return EVENT_GROUPS.filter((g) => admin || !g.admin);
}

/** A chip is lit when any of its kinds is in the filter. */
export function groupLit(f: EventFilter, g: EventGroup): boolean {
  return g.kinds.some((k) => f.kinds.includes(k));
}

/** The filter after a click on a group's chip: a lit one takes all its kinds out, an unlit one puts them all in. Starts at the top again. */
export function toggleGroup(f: EventFilter, g: EventGroup): EventFilter {
  const next = groupLit(f, g) ? f.kinds.filter((k) => !g.kinds.includes(k)) : [...f.kinds, ...g.kinds];
  return { ...f, kinds: EVENT_KINDS.filter((k) => next.includes(k)), before: null };
}

/** The "Everything" chip: no kinds, the other filters kept. */
export function everything(f: EventFilter): EventFilter {
  return { ...f, kinds: [], before: null };
}

const dayWords = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** docs/29 rule 5: what is narrowed, in one line ("Showing deaths and advancements · samoyedx · from 1 Oct"), or null when nothing is. */
export function filterWords(f: EventFilter, admin: boolean): string | null {
  const parts: string[] = [];
  const kinds: string[] = [];
  for (const g of groupsFor(admin)) {
    const inF = g.kinds.filter((k) => f.kinds.includes(k));
    if (inF.length === g.kinds.length) kinds.push(g.words);
    else kinds.push(...inF.map((k) => KIND_WORDS[k]));
  }
  if (kinds.length) parts.push(and(kinds));
  if (f.player) parts.push(f.player);
  if (f.from && f.to) parts.push(`${dayWords.format(f.from)} to ${dayWords.format(f.to)}`);
  else if (f.from) parts.push(`from ${dayWords.format(f.from)}`);
  else if (f.to) parts.push(`up to ${dayWords.format(f.to)}`);
  if (f.text) parts.push(`with “${f.text}”`);
  if (!parts.length) return null;
  return `Showing ${kinds.length ? "" : "everything · "}${parts.join(" · ")}`;
}

export type EventWhere = {
  kind: { in: EventKind[] };
  at?: { gte?: Date; lte?: Date };
  id?: { lt: bigint };
  actor?: { in: string[] };
  message?: { contains: string; mode: "insensitive" };
  /** Rows marked `meta.superseded` stay in the table and out of the log (2026-09-30: the player-list loop's 2,408 joins and leaves). */
  NOT: { meta: { path: string[]; equals: boolean } };
};

/**
 * `actors` are the ids the chosen player goes by (their Minecraft UUID and their portal user id).
 * A player who is not an admin only ever gets PLAYER_KINDS, whatever the filter says.
 */
export function eventWhere(f: EventFilter, admin: boolean, actors: string[] | null): EventWhere {
  const allowed: readonly EventKind[] = admin ? EVENT_KINDS : PLAYER_KINDS;
  const kinds = f.kinds.filter((k) => allowed.includes(k));
  const where: EventWhere = { kind: { in: kinds.length ? kinds : [...allowed] }, NOT: { meta: { path: ["superseded"], equals: true } } };
  if (f.from || f.to) where.at = { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) };
  if (f.before !== null) where.id = { lt: f.before };
  if (f.player) where.actor = { in: actors ?? [] };
  if (f.text) where.message = { contains: f.text, mode: "insensitive" };
  return where;
}

/** One CSV field: quoted when needed, and never starting with a character a spreadsheet would run as a formula. */
export function csvField(v: unknown): string {
  let s = v === null || v === undefined ? "" : typeof v === "string" ? v : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}
