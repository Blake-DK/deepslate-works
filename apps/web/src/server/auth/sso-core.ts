// Sign-in through Authentik (docs/04 "Sign-in through Authentik"). Pure, so it is tested.
//
// Authentik is the identity provider: a member signs in there with Discord or Microsoft, and the site gets an id token
// with the member's `sub` (one per Authentik user) and the custom `deepslate` claim: `discord_id`, the identifier of the
// Authentik user's Discord connection, and `deepslate_roles`, their Authentik groups whose names start with
// "deepslate-". No email and no other group names are asked for.

export type Role = "ADMIN" | "PLAYER";

/** The one group that makes an admin. Everyone else is a player; the Tester switch stays on the site (docs/57). */
export const ADMIN_GROUP = "deepslate-admins";

export type SsoClaims = {
  sub: string;
  /** From the Authentik user's Discord connection, whichever button they pressed. Null: no Discord connection. */
  discordId: string | null;
  /** Null when the claim is missing or not a list: then a sign-in changes nobody's role. */
  roles: string[] | null;
  name: string | null;
};

const DISCORD_ID_RE = /^\d{5,25}$/;

/** The claims of an id token, checked. Null when there is no usable `sub`. */
export function parseSsoClaims(profile: unknown): SsoClaims | null {
  const p = (profile ?? {}) as Record<string, unknown>;
  const sub = typeof p.sub === "string" ? p.sub.trim() : "";
  if (!sub || sub.length > 255) return null;
  const rawId = typeof p.discord_id === "number" ? String(p.discord_id) : p.discord_id;
  const discordId = typeof rawId === "string" && DISCORD_ID_RE.test(rawId) ? rawId : null;
  const roles = Array.isArray(p.deepslate_roles) ? p.deepslate_roles.filter((r): r is string => typeof r === "string") : null;
  const named = [p.name, p.preferred_username].find((v): v is string => typeof v === "string" && v.trim() !== "");
  return { sub, discordId, roles, name: named ? named.trim().slice(0, 64) : null };
}

export type Linkable = { id: string; discordId: string | null; authentikSub: string | null };

export type Link<U extends Linkable> =
  /** `firstLink`: the account had no Authentik user before. `relink`: it had another one (now replaced). */
  | { kind: "existing"; user: U; firstLink: boolean; relink: boolean; setDiscordId: string | null }
  | { kind: "new" }
  | { kind: "conflict"; detail: string };

/**
 * Which account a sign-in is (Alex, 2026-10-20): linked by Discord ID only, never by email.
 *   1. the account whose Discord ID is the claim's: the Discord ID is the anchor (relinked if another sub had it);
 *   2. else the account already linked to this sub;
 *   3. else a new account (the door decides whether one may be made: the Discord server, or an invite link).
 * A Microsoft-only sign-in with no Discord connection therefore never lands in an account made before.
 * Two different accounts for one sign-in, or a linked account whose Discord ID is another one, is a conflict: refused
 * and left to an admin, never merged.
 */
export function ssoLink<U extends Linkable>(c: Pick<SsoClaims, "sub" | "discordId">, bySub: U | null, byDiscord: U | null): Link<U> {
  if (c.discordId && byDiscord) {
    if (bySub && bySub.id !== byDiscord.id) return { kind: "conflict", detail: "this Authentik user is linked to another account" };
    return { kind: "existing", user: byDiscord, firstLink: byDiscord.authentikSub === null, relink: byDiscord.authentikSub !== null && byDiscord.authentikSub !== c.sub, setDiscordId: null };
  }
  if (bySub) {
    if (c.discordId && bySub.discordId && bySub.discordId !== c.discordId) return { kind: "conflict", detail: "the account has another Discord ID" };
    // A Microsoft-only account whose Authentik user has since been connected to Discord takes that Discord ID.
    return { kind: "existing", user: bySub, firstLink: false, relink: false, setDiscordId: c.discordId && !bySub.discordId ? c.discordId : null };
  }
  return { kind: "new" };
}

/**
 * The role a sign-in leaves an existing account with, or null for "as it is". Authentik's group decides, both ways,
 * with three guards (Alex, 2026-10-20): a missing claim changes nothing; the owner (ADMIN_DISCORD_ID) is never made a
 * player; the sign-in that first links an existing account keeps its role (the next one follows the group).
 */
export function ssoRole(i: { current: Role; roles: string[] | null; owner: boolean; firstLink: boolean }): Role | null {
  if (i.roles === null || i.firstLink) return null;
  const want: Role = i.roles.includes(ADMIN_GROUP) ? "ADMIN" : "PLAYER";
  if (want === i.current) return null;
  if (want === "PLAYER" && i.owner) return null;
  return want;
}

/** A new account is an admin when Authentik's group says so (the owner and the very first account are, regardless). */
export const ssoNewAdmin = (roles: string[] | null) => Boolean(roles?.includes(ADMIN_GROUP));
