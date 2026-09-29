// SHARED FILE: apps/web/src/shared/ and apps/api/src/shared/ hold identical copies (a test compares them).
// Edit the copy in apps/web, then `cp apps/web/src/shared/*.ts apps/api/src/shared/`.
//
// docs/14 "Play first": a member is let into the world when their last run of Play went through, not longer ago
// than the window, with the pack the server runs. api decides with this at every join; the portal uses the same
// rule to say "Ready to join until 10:35". Pure, so it is tested.

export const GATE_REASONS = ["no report", "stale", "wrong version"] as const;
export type GateReason = (typeof GATE_REASONS)[number];

export type PlayRun = { at: Date; packVersion: string };
export type Gate = { ok: true; until: Date } | { ok: false; reason: GateReason };

/**
 * `run`: their latest run of Play that went through. `serverPack`: the pack last synced to the server, null when
 * that is not known (then the version is not looked at). Time first: a run from yesterday is "stale" whatever its pack.
 */
export function playGate(run: PlayRun | null, serverPack: string | null, windowMin: number, now: Date): Gate {
  if (!run) return { ok: false, reason: "no report" };
  const until = new Date(run.at.getTime() + windowMin * 60_000);
  if (now.getTime() > until.getTime()) return { ok: false, reason: "stale" };
  if (serverPack && run.packVersion !== serverPack) return { ok: false, reason: "wrong version" };
  return { ok: true, until };
}

export const GATE_TEXT: Record<GateReason, string> = {
  "no report": "has not pressed Play on the site",
  stale: "pressed Play too long ago",
  "wrong version": "pressed Play before the pack changed",
};
