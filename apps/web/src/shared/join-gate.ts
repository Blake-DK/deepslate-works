// SHARED FILE: apps/web/src/shared/ and apps/api/src/shared/ hold identical copies (a test compares them).
// Edit the copy in apps/web, then `cp apps/web/src/shared/*.ts apps/api/src/shared/`.
//
// docs/14 "Play first": a member is let into the world when their last run of Play went through, not longer ago
// than the window, with the pack the server runs. api decides with this at every join; the portal uses the same
// rule to say "Ready to join until 10:35". Pure, so it is tested.
const SITE_HOST = ((typeof process === "undefined" ? undefined : process.env.PORTAL_URL ?? process.env.AUTH_URL) ?? "https://deepslate.dsw.test").replace(/^https?:\/\//, "").replace(/\/+$/, ""); // as shared/site.ts (no imports between shared files: api needs ".js", web does not)

export const GATE_REASONS = ["no report", "old installer", "missing mods", "stale", "wrong version"] as const;

/**
 * The runs that count as "pressed Play": the Play button, and a run of Setup.bat that went through. A fresh install
 * is the current pack by definition (planner, 2026-09-29, after Bramble09 was held although he had just installed).
 */
// App 3.3.0: the Update button's run counts too: it proves the right pack is on the PC (planner 2026-10-02).
export const PLAY_MODES = ["play", "install", "first_install", "update", "update_only"] as const; // not already_running: that run did nothing
export type GateReason = (typeof GATE_REASONS)[number];

/** `installerVersion`: which installer made the run ("unknown" from installers that did not say). */
export type PlayRun = { at: Date; packVersion: string; installerVersion?: string | null };

/** Is version `a` older than `b`? Anything that is not a version counts as older (it is from before installers said). */
export function olderThan(a: string | null | undefined, b: string): boolean {
  const parse = (v: string) => (/^\d{1,4}(\.\d{1,4}){1,3}$/.test(v) ? v.split(".").map(Number) : null);
  const want = parse(b);
  if (!want) return false;
  const have = a ? parse(a) : null;
  if (!have) return true;
  for (let i = 0; i < Math.max(have.length, want.length); i++) {
    const x = have[i] ?? 0, y = want[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}
export type Gate = { ok: true; until: Date } | { ok: false; reason: GateReason };

/**
 * `run`: their latest run of Play, or of the installer, that went through (PLAY_MODES). `serverPack`: the pack last synced to the server, null when
 * that is not known (then the version is not looked at). Time first: a run from yesterday is "stale" whatever its pack.
 */
export function playGate(run: PlayRun | null, serverPack: string | null, windowMin: number, now: Date, minInstaller = "", modsMissing = false): Gate {
  if (!run) return { ok: false, reason: "no report" };
  // `minInstaller`: the app the site hands out now (installer-info.ts requiredInstaller, Alex 2026-10-06). A run from
  // an older one does not count; pressing Play updates it first. Comes before "stale", which says less.
  if (minInstaller && olderThan(run.installerVersion, minInstaller)) return { ok: false, reason: "old installer" };
  // 2.1.0 (2026-10-01, kanefinch's TaCZ kick): the game on their PC was seen without some of the pack's mods since
  // their last Play (`modsMissing`). Play repairs it, so this says so before anything about time or version.
  if (modsMissing) return { ok: false, reason: "missing mods" };
  const until = new Date(run.at.getTime() + windowMin * 60_000);
  if (now.getTime() > until.getTime()) return { ok: false, reason: "stale" };
  if (serverPack && run.packVersion !== serverPack) return { ok: false, reason: "wrong version" };
  return { ok: true, until };
}

/** Why somebody was held at the door: the server is not open for them yet, a vote they have not answered, or Play first. */
export type BlockReason = GateReason | "not live" | "vote";

export const GATE_TEXT: Record<BlockReason, string> = {
  "not live": "the server is not open yet",
  vote: "has not answered the new vote",
  "no report": "has not pressed Play on the site",
  "old installer": "has not updated Deepslate Works yet",
  "missing mods": "started the game without some of the pack's mods",
  stale: "pressed Play too long ago",
  "wrong version": "pressed Play before the pack changed",
};

/** What somebody reads while their game is missing mods (planner, 2026-10-01): on the site, in the app and in the room. */
export const MISSING_MODS_TEXT = "Your game is missing some mods. Press Play on the site to fix it.";

/**
 * Was the game on their PC seen without some of the pack's mods after their last Play that went through? `mods`: the
 * newest report that says anything about the mod set (a Play run's final check, or the app's look at the game's log
 * after it started). `refusedAt`: the last time the server refused them at the handshake for a missing mod.
 */
export function modsMissingSince(run: PlayRun | null, mods: { at: Date; ok: boolean } | null, refusedAt: Date | null): boolean {
  if (mods && !mods.ok && (!run || mods.at.getTime() >= run.at.getTime())) return true;
  return Boolean(refusedAt && (!run || refusedAt.getTime() > run.at.getTime()));
}

/** What somebody reads in the room while their installer is below the minimum (planner, installer 1.5.0). */
export const OLD_INSTALLER_TEXT = `Press Play on ${SITE_HOST} to update Deepslate Works`;
