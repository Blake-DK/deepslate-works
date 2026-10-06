// docs/05: which news items are shown, and which of them are pinned, at a given moment. Pure, so it is tested.
//   pinned + pinnedUntil   pinned until then, an ordinary item after it (nobody has to unpin it)
//   expiresAt              from then on members do not see it; admins still do, marked as such

import { ukLocalToDate } from "./uk-time";

export type Dated = { pinned: boolean; pinnedUntil: Date | null; expiresAt: Date | null; createdAt: Date };

export const isPinnedNow = (n: Dated, now: Date) => n.pinned && (!n.pinnedUntil || n.pinnedUntil.getTime() > now.getTime());
export const isExpired = (n: Dated, now: Date) => Boolean(n.expiresAt && n.expiresAt.getTime() <= now.getTime());

/** At most three pinned (newest first), then the newest `recent` others. Expired ones only with `withExpired`. */
export function arrangeNews<T extends Dated>(rows: T[], now: Date, recent: number, withExpired = false): Array<T & { pinnedNow: boolean; expired: boolean }> {
  const all = [...rows]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => ({ ...r, pinnedNow: isPinnedNow(r, now), expired: isExpired(r, now) }))
    .filter((r) => withExpired || !r.expired);
  const pinned = all.filter((r) => r.pinnedNow && !r.expired).slice(0, 3);
  const rest = all.filter((r) => !pinned.includes(r)).slice(0, recent);
  return [...pinned, ...rest];
}

export type NewsDates = { ok: true; pinnedUntil: Date | null; expiresAt: Date | null } | { ok: false; reason: string };

/** The two optional boxes (UK time, `datetime-local`). Empty = none; a date must be in the future. */
export function parseNewsDates(pinnedUntil: string, expires: string, now: Date): NewsDates {
  const one = (v: string, what: string): Date | null | string => {
    if (!v.trim()) return null;
    const d = ukLocalToDate(v.trim());
    if (!d) return `${what}: not a date.`;
    if (d.getTime() <= now.getTime()) return `${what}: that is in the past.`;
    return d;
  };
  const p = one(pinnedUntil, "Pinned until");
  if (typeof p === "string") return { ok: false, reason: p };
  const e = one(expires, "Hide from");
  if (typeof e === "string") return { ok: false, reason: e };
  if (p && e && p.getTime() > e.getTime()) return { ok: false, reason: "Pinned until is after it is hidden." };
  return { ok: true, pinnedUntil: p, expiresAt: e };
}

const ABOUT_VOTES = /\b(vote|votes|voting|poll|polls)\b/i;

/** Where the app's pinned news opens on the site (Alex, 2026-10-06): the Votes page when it is about a vote, otherwise
 *  the item itself on Home (each item there has the anchor news-<id>). */
export function newsLink(site: string, n: { id: string; body: string }): string {
  return ABOUT_VOTES.test(n.body) ? `${site}/votes` : `${site}/#news-${n.id}`;
}
