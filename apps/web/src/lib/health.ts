import { timingSafeEqual } from "node:crypto";

// docs/31 B-39: what /api/health tells somebody who is not an admin: whether each part is well, never what is wrong
// with it. Enough for a monitor to alert on ("ok":true, "api":{"ok":true}, "watch":true, "pack":{"same":true}).

type Full = { ok: boolean; db: boolean; api: { ok: boolean; watch?: boolean }; pack: { same: boolean | null } | null };

/** `watch`: api's health watch (dumps, backups, the pack, the last wake); false when any of them is wrong. */
export function publicHealth(h: Full): { ok: boolean; db: boolean; api: { ok: boolean }; watch: boolean; pack: { same: boolean | null } | null } {
  return { ok: h.ok, db: h.db, api: { ok: Boolean(h.api.ok) }, watch: h.api.watch !== false, pack: h.pack ? { same: h.pack.same } : null };
}

/** Does the caller hold the key (the service token)? Constant time; an unset key opens nothing. */
export function holdsKey(given: string | null, key: string): boolean {
  if (!given || key.length < 32) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
