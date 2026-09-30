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
