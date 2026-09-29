"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { closeVote } from "@/server/vote/votes";
import { parseQuestions } from "@/server/vote/tally";
import { audit } from "@/server/events";

const createSchema = z.object({
  title: z.string().trim().min(2).max(80),
  closesAt: z.string().optional(),
  questions: z.string(),
});

export async function createVoteAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/admin/votes?error=form");
  let questions: unknown;
  try {
    questions = JSON.parse(parsed.data.questions || "[]");
  } catch {
    redirect("/admin/votes?error=json");
  }
  const clean = parseQuestions(questions);
  const closesAt = parsed.data.closesAt ? new Date(parsed.data.closesAt) : null;
  if (closesAt && Number.isNaN(closesAt.getTime())) redirect("/admin/votes?error=form");
  const vote = await db.vote.create({ data: { title: parsed.data.title, questions: clean as unknown as Prisma.InputJsonValue, closesAt } });
  await audit({ userId: admin.id, action: "vote.create", params: { voteId: vote.id, title: vote.title }, result: "OK" });
  revalidatePath("/admin/votes");
  redirect("/admin/votes");
}

export async function openVoteAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const open = await db.vote.count({ where: { status: "OPEN" } });
  if (open > 0) redirect("/admin/votes?error=already-open");
  const vote = await db.vote.findUnique({ where: { id } });
  if (!vote || vote.status !== "DRAFT") redirect("/admin/votes");
  await db.vote.update({ where: { id }, data: { status: "OPEN", opensAt: new Date() } });
  await audit({ userId: admin.id, action: "vote.open", params: { voteId: id }, result: "OK" });
  revalidatePath("/admin/votes");
  revalidatePath("/vote");
  redirect("/admin/votes");
}

export async function closeVoteAdminAction(formData: FormData) {
  const admin = await requireAdmin();
  await closeVote(String(formData.get("id") ?? ""), admin.id);
  revalidatePath("/admin/votes");
  revalidatePath("/vote");
  redirect("/admin/votes");
}

export async function deleteVoteAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const vote = await db.vote.findUnique({ where: { id }, include: { _count: { select: { ballots: true } } } });
  if (!vote || vote.status === "OPEN") redirect("/admin/votes");
  await db.vote.delete({ where: { id } });
  await audit({ userId: admin.id, action: "vote.delete", params: { voteId: id, title: vote.title, ballots: vote._count.ballots }, result: "OK" });
  revalidatePath("/admin/votes");
  redirect("/admin/votes");
}
