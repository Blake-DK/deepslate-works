// SHARED FILE: apps/web/src/shared/ and apps/api/src/shared/ hold identical copies (a test compares them).
// Edit the copy in apps/web, then `cp apps/web/src/shared/*.ts apps/api/src/shared/`.
//
// docs/13 "Early access": who may do what while "We're live" is off. One place, pure, tested as a table.
//
//   admin          everything, always; never held at the door for Play
//   early access   a player like any other once the site is live: sees the address, downloads, presses Play,
//                  and Play first applies to them. Nothing of an admin's.
//   player         while not live: no address, no downloads, no Play. Once live: as above.

/** `maintenanceJoin`: docs/48 B1, "Can join during maintenance", a tick only an admin can have. */
export type Member = { role: "ADMIN" | "PLAYER"; earlyAccess?: boolean | null; maintenanceJoin?: boolean | null };

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

/**
 * A report that says "it went through" can only come from somebody the portal is open for: nobody else can have
 * fetched the mod list. Reports of runs that failed or were stopped are taken from every member, they are what
 * Alex reads when something goes wrong.
 */
export function mayReport(user: Member | null | undefined, live: boolean, outcome: string): boolean {
  if (!user) return false;
  return outcome !== "ok" || isOpenFor(user, live);
}

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

export type Door = "in" | "maintenance" | "not open" | "vote first" | "play first";

/**
 * docs/48 B1: the site's Maintenance (not AMP's state of the same name). While it is on, only an admin with the tick
 * "Can join during maintenance" comes in; an admin without it waits like a player.
 */
export function joinsDuringMaintenance(user: Member): boolean {
  return user.role === "ADMIN" && user.maintenanceJoin === true;
}

/**
 * At the door, for a linked member of the Discord server. First, the site's Maintenance (docs/48 B2): while it is on,
 * only an admin with the tick goes on. Then: is the server open for them, live or early access (admins always)? If
 * not they wait, whatever else. Then the must-vote polls (planner 2026-10-02): `unvoted` is how many open must-vote
 * polls they have not answered; admins are asked like everyone else but never held. Then Play first. `hasPlayed`:
 * their last run of Play went through, inside the window, with the server's pack (shared/join-gate).
 */
export function doorRule(user: Member, d: { live: boolean; requirePlay: boolean; hasPlayed: boolean; unvoted?: number; maintenance?: boolean }): Door {
  if (d.maintenance && !joinsDuringMaintenance(user)) return "maintenance";
  if (!isOpenFor(user, d.live)) return "not open";
  if (user.role !== "ADMIN" && (d.unvoted ?? 0) > 0) return "vote first";
  return !playFirstApplies(user, d.requirePlay) || d.hasPlayed ? "in" : "play first";
}

/** What somebody reads in the room while the server is not open for them. */
export const NOT_OPEN_TEXT = "Not open yet. You'll be let in when the server goes live.";

/** docs/48 B2: the same words on screen, in chat, in the reminder, the idle kick and the kick when it is switched on. */
export const MAINTENANCE_TEXT = "Down for maintenance. You'll be let in when it's done.";
