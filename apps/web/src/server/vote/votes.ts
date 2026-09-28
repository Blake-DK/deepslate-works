import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { getManifest, votableMods } from "@/server/modpack/manifest";
import { parseQuestions, tally, type BallotRow, type Tally } from "./tally";

export async function getOpenVote() {
  const vote = await db.vote.findFirst({ where: { status: "OPEN" }, orderBy: { opensAt: "desc" } });
  if (!vote) return null;
  if (vote.closesAt && vote.closesAt.getTime() <= Date.now()) {
    await closeVote(vote.id, null); // deadline passed: freeze it now
    return null;
  }
  return vote;
}

/** The vote whose results people should see: the open one (admins), else the most recently closed. */
export async function getResultsVote() {
  return (
    (await db.vote.findFirst({ where: { status: "OPEN" }, orderBy: { opensAt: "desc" } })) ??
    (await db.vote.findFirst({ where: { status: "CLOSED" }, orderBy: { closesAt: "desc" } }))
  );
}

export async function loadBallots(voteId: string): Promise<BallotRow[]> {
  const rows = await db.ballot.findMany({ where: { voteId }, include: { user: { select: { pcTier: true } } } });
  return rows.map((r) => ({ modIds: r.modIds, answers: (r.answers ?? {}) as Record<string, string>, pcTier: r.user.pcTier }));
}

export async function tallyVote(vote: { id: string; questions: Prisma.JsonValue }): Promise<Tally> {
  const manifest = await getManifest();
  const mods = votableMods(manifest);
  return tally(mods, parseQuestions(vote.questions), await loadBallots(vote.id));
}

export async function closeVote(voteId: string, adminId: string | null) {
  const vote = await db.vote.findUnique({ where: { id: voteId } });
  if (!vote || vote.status !== "OPEN") return null;
  const result = await tallyVote(vote);
  const closed = await db.vote.update({ where: { id: voteId }, data: { status: "CLOSED", closesAt: new Date(), resultJson: result as unknown as Prisma.InputJsonValue } });
  await db.auditLog.create({ data: { userId: adminId, action: "vote.close", params: { voteId, ballots: result.ballots, auto: adminId === null }, result: "OK" } });
  return closed;
}
