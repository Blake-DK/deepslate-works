import { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { modsMissingSince, type PlayRun, TEST_MODES } from "../shared/join-gate.js";

/**
 * 2.1.0: was the game on their PC seen without some of the pack's mods since their last Play (`modsMissingSince`)?
 * The newest report that says anything about the mods, and the last time the server refused them at the handshake.
 * The same question as web's server/play.ts `modsMissingFor`.
 */
export async function modsMissingFor(userId: string, run: PlayRun | null): Promise<boolean> {
  const [mods, refused] = await Promise.all([
    db.installReport.findFirst({ where: { userId, mods: { not: Prisma.DbNull }, mode: { notIn: TEST_MODES } }, orderBy: { at: "desc" }, select: { at: true, mods: true } }),
    db.event.findFirst({ where: { kind: "JOIN_BLOCKED", actor: userId, meta: { path: ["params", "reason"], equals: "missing mods" } }, orderBy: { at: "desc" }, select: { at: true } }),
  ]);
  const ok = (mods?.mods as { ok?: unknown } | null)?.ok;
  return modsMissingSince(run, mods && typeof ok === "boolean" ? { at: mods.at, ok } : null, refused?.at ?? null);
}
