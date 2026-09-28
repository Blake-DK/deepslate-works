"use server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { requireOnboardedUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { getManifest, votableMods } from "@/server/modpack/manifest";
import { getOpenVote } from "@/server/vote/votes";
import { parseQuestions } from "@/server/vote/tally";

const schema = z.object({
  voteId: z.string().min(1),
  modIds: z.array(z.string()).max(200),
  answers: z.record(z.string(), z.string()),
});

export type SaveResult = { ok: true; savedAt: string } | { ok: false; error: string };

export async function saveBallot(input: unknown): Promise<SaveResult> {
  const user = await requireOnboardedUser();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That didn't look right. Reload and try again." };
  const vote = await getOpenVote();
  if (!vote || vote.id !== parsed.data.voteId) return { ok: false, error: "This vote has closed." };
  const manifest = await getManifest();
  const votable = votableMods(manifest);
  const known = new Map(votable.map((m) => [m.slug, m]));
  const modIds = [...new Set(parsed.data.modIds)].filter((s) => known.has(s));
  // one per exclusive group, server side too
  const seenGroup = new Set<string>();
  const cleanIds = modIds.filter((slug) => {
    const g = known.get(slug)!.exclusiveGroup;
    if (!g) return true;
    if (seenGroup.has(g)) return false;
    seenGroup.add(g);
    return true;
  });
  const questions = parseQuestions(vote.questions);
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const a = parsed.data.answers[q.id];
    if (a && q.options.includes(a)) answers[q.id] = a;
  }
  const ballot = await db.ballot.upsert({
    where: { voteId_userId: { voteId: vote.id, userId: user.id } },
    create: { voteId: vote.id, userId: user.id, modIds: cleanIds, answers: answers as Prisma.InputJsonValue },
    update: { modIds: cleanIds, answers: answers as Prisma.InputJsonValue },
  });
  await db.auditLog.create({ data: { userId: user.id, action: "ballot.save", params: { voteId: vote.id, picked: cleanIds.length }, result: "OK" } });
  return { ok: true, savedAt: ballot.submittedAt.toISOString() };
}
