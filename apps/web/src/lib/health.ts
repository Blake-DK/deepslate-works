// docs/31 B-39: what /api/health tells somebody who is not an admin: whether each part is well, never what is wrong
// with it. Enough for a monitor to alert on ("ok":true, "api":{"ok":true}, "pack":{"same":true}).

type Full = { ok: boolean; db: boolean; api: { ok: boolean }; pack: { same: boolean | null } | null };

export function publicHealth(h: Full): { ok: boolean; db: boolean; api: { ok: boolean }; pack: { same: boolean | null } | null } {
  return { ok: h.ok, db: h.db, api: { ok: Boolean(h.api.ok) }, pack: h.pack ? { same: h.pack.same } : null };
}
