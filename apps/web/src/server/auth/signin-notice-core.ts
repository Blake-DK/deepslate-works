// The admin sign-in notice (planner, 2026-10-01) and acknowledging it (Alex, 2026-10-07), the decisions themselves,
// with everything they read and write handed in, so the tests run them without a database. Each admin has their own
// "seen up to" time (User.signInNoticeSeenAt); the notice lists the password and one-time-link sign-ins after it, and
// never older than 24 hours. One click moves it to the newest sign-in the banner showed, never further.

export const NOTICE_ACTIONS = ["auth.adminPassword", "auth.adminLink"] as const;
export const NOTICE_HOURS = 24;
export const NOTICE_SHOWN = 5;

export type NoticeRow = { id: bigint; at: Date; actor: string | null; message: string };
/** Sign-ins after the admin's "seen up to" time (`gt`), or, with nothing seen in the last day, from a day ago (`gte`). */
export type NoticeWindow = { gt: Date } | { gte: Date };
export type NoticeLabel = "That was me" | "Seen it";

export function noticeWindow(now: number, seenAt: Date | null): NoticeWindow {
  const dayAgo = new Date(now - NOTICE_HOURS * 3600_000);
  return seenAt && seenAt >= dayAgo ? { gt: seenAt } : { gte: dayAgo };
}

export function inWindow(at: Date, w: NoticeWindow): boolean {
  return "gt" in w ? at > w.gt : at >= w.gte;
}

/** "That was me" only when every sign-in listed is the viewing admin's own. */
export function noticeLabel(rows: Array<Pick<NoticeRow, "actor">>, viewerId: string): NoticeLabel {
  return rows.length > 0 && rows.every((r) => r.actor === viewerId) ? "That was me" : "Seen it";
}

export type NoticeDeps = {
  seenAt(userId: string): Promise<Date | null>;
  /** Notice sign-ins in the window, newest first, at most `take`. */
  list(w: NoticeWindow, take: number): Promise<NoticeRow[]>;
  now(): number;
};

export type Notice = { rows: NoticeRow[]; label: NoticeLabel; newest: bigint | null };

export async function noticeFor(viewerId: string, deps: NoticeDeps): Promise<Notice> {
  const rows = await deps.list(noticeWindow(deps.now(), await deps.seenAt(viewerId)), NOTICE_SHOWN);
  return { rows, label: noticeLabel(rows, viewerId), newest: rows[0]?.id ?? null };
}

export type AckDeps = NoticeDeps & {
  /** The notice sign-in with this event id; null when there is none or the event is something else. */
  find(id: bigint): Promise<NoticeRow | null>;
  /** How many notice sign-ins are in the window up to and including `upTo`. */
  count(w: NoticeWindow, upTo: Date): Promise<number>;
  /** Sets the admin's "seen up to" time to `at` only while it is unset or earlier; false when it was not moved. */
  advance(userId: string, at: Date): Promise<boolean>;
  audit(userId: string, covered: number): Promise<void>;
};

export type AckInput = {
  viewer: { id: string; role: "ADMIN" | "PLAYER" };
  /** The request's Origin names another site. */
  foreign: boolean;
  /** The event id of the newest sign-in the banner showed, as the form sent it. Nothing else comes from the page. */
  shown: string;
};

export type AckRefusal = "another site" | "not an admin" | "not an event id" | "not a notice sign-in" | "in the future" | "not on the notice";
export type AckResult = { ok: true; covered: number; seenAt: Date } | { ok: false; why: AckRefusal };

export async function acknowledgeNotice(input: AckInput, deps: AckDeps): Promise<AckResult> {
  if (input.foreign) return { ok: false, why: "another site" };
  if (input.viewer.role !== "ADMIN") return { ok: false, why: "not an admin" };
  if (!/^\d{1,18}$/.test(input.shown)) return { ok: false, why: "not an event id" };
  const row = await deps.find(BigInt(input.shown));
  if (!row) return { ok: false, why: "not a notice sign-in" };
  const now = deps.now();
  if (row.at.getTime() > now) return { ok: false, why: "in the future" };
  // already seen, or older than the notice's 24 hours: nothing to move, and never backwards
  const w = noticeWindow(now, await deps.seenAt(input.viewer.id));
  if (!inWindow(row.at, w)) return { ok: false, why: "not on the notice" };
  const covered = await deps.count(w, row.at);
  if (!(await deps.advance(input.viewer.id, row.at))) return { ok: false, why: "not on the notice" };
  await deps.audit(input.viewer.id, covered);
  return { ok: true, covered, seenAt: row.at };
}
