// SHARED FILE: apps/web/src/shared/ and apps/api/src/shared/ hold identical copies (a test compares them).
// Edit the copy in apps/web, then `cp apps/web/src/shared/*.ts apps/api/src/shared/`.
//
// docs/13 "Early access": who may do what while "We're live" is off. One place, pure, tested as a table.
//
//   admin          everything, always; never held at the door for Play
//   early access   a player like any other once the site is live: sees the address, downloads, presses Play,
//                  and Play first applies to them. Nothing of an admin's.
//   player         while not live: no address, no downloads, no Play. Once live: as above.

export type Member = { role: "ADMIN" | "PLAYER"; earlyAccess?: boolean | null };

/** Is the portal open for them: the address, the installer, the Play button? */
export function isOpenFor(user: Member | null | undefined, live: boolean): boolean {
  if (!user) return false;
  return user.role === "ADMIN" || live || user.earlyAccess === true;
}

export type DownloadReason = "admin" | "online" | "offline" | "anonymous" | "not_live";

/** The installer, the pack and the mod list. `serverAvailable`: running, or asleep and ready to wake. */
export function downloadRule(user: Member | null | undefined, live: boolean, serverAvailable: boolean): { ok: boolean; reason: DownloadReason } {
  if (!user) return { ok: false, reason: "anonymous" };
  if (user.role === "ADMIN") return { ok: true, reason: "admin" };
  if (!isOpenFor(user, live)) return { ok: false, reason: "not_live" };
  return serverAvailable ? { ok: true, reason: "online" } : { ok: false, reason: "offline" };
}

/** Pressing Play is fetching the mod list and sending a report: whoever may download may press Play. */
export const playRule = downloadRule;

/** Does "Play first" apply at the door? To everybody but admins, early access or not. */
export function playFirstApplies(user: Member, requirePlay: boolean): boolean {
  return requirePlay && user.role !== "ADMIN";
}

/** "Early access: things may still break…": for members with the flag while the site is not live. Not for admins. */
export function earlyBanner(user: Member | null | undefined, live: boolean): boolean {
  return Boolean(user && user.role !== "ADMIN" && user.earlyAccess === true && !live);
}

/** May they see what is for admins? The flag has nothing to do with it. */
export function isAdmin(user: Member | null | undefined): boolean {
  return user?.role === "ADMIN";
}

/**
 * At the door, for a linked member of the Discord server: let in, or held until they have pressed Play.
 * `hasPlayed`: their last run of Play went through, inside the window, with the server's pack (shared/join-gate).
 */
export function doorRule(user: Member, requirePlay: boolean, hasPlayed: boolean): "in" | "play first" {
  return !playFirstApplies(user, requirePlay) || hasPlayed ? "in" : "play first";
}
