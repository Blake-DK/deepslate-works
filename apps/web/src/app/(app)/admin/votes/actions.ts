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
import { closePoll, deletePoll, editPoll, openPoll, setPollMustVote } from "@/server/polls";
import { storePhoto } from "@/server/news-images";
import { getManifest, modBySlug } from "@/server/modpack/manifest";
import { ukLocalToDate } from "@/lib/uk-time";
import { makeOptions, MAX_OPTIONS, type EditRow } from "@/shared/polls";

const createSchema = z.object({
  title: z.string().trim().min(2).max(80),
  closesAt: z.string().optional(),
  questions: z.string(),
});

export async function createVoteAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/admin/pack?tab=modvote&error=form");
  let questions: unknown;
  try {
    questions = JSON.parse(parsed.data.questions || "[]");
  } catch {
    redirect("/admin/pack?tab=modvote&error=json");
  }
  const clean = parseQuestions(questions);
  // typed as UK time, like a poll's and a news item's dates (docs/31 B-34: it was read as UTC, an hour late in summer)
  const closesAt = parsed.data.closesAt ? ukLocalToDate(parsed.data.closesAt) : null;
  if (parsed.data.closesAt && (!closesAt || Number.isNaN(closesAt.getTime()))) redirect("/admin/pack?tab=modvote&error=form");
  const vote = await db.vote.create({ data: { title: parsed.data.title, questions: clean as unknown as Prisma.InputJsonValue, closesAt } });
  await audit({ userId: admin.id, action: "vote.create", params: { voteId: vote.id, title: vote.title }, result: "OK" });
  revalidatePath("/admin/pack");
  redirect("/admin/pack?tab=modvote");
}

export async function openVoteAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const open = await db.vote.count({ where: { status: "OPEN" } });
  if (open > 0) redirect("/admin/pack?tab=modvote&error=already-open");
  const vote = await db.vote.findUnique({ where: { id } });
  if (!vote || vote.status !== "DRAFT") redirect("/admin/pack?tab=modvote");
  await db.vote.update({ where: { id }, data: { status: "OPEN", opensAt: new Date() } });
  await audit({ userId: admin.id, action: "vote.open", params: { voteId: id }, result: "OK" });
  revalidatePath("/admin/pack");
  revalidatePath("/pack");
  redirect("/admin/pack?tab=modvote");
}

export async function closeVoteAdminAction(formData: FormData) {
  const admin = await requireAdmin();
  await closeVote(String(formData.get("id") ?? ""), admin.id);
  revalidatePath("/admin/pack");
  revalidatePath("/pack");
  redirect("/admin/pack?tab=modvote");
}

export async function deleteVoteAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const vote = await db.vote.findUnique({ where: { id }, include: { _count: { select: { ballots: true } } } });
  if (!vote || vote.status === "OPEN") redirect("/admin/pack?tab=modvote");
  await db.vote.delete({ where: { id } });
  await audit({ userId: admin.id, action: "vote.delete", params: { voteId: id, title: vote.title, ballots: vote._count.ballots }, result: "OK" });
  revalidatePath("/admin/pack");
  redirect("/admin/pack?tab=modvote");
}

// ---- quick polls (planner 2026-10-02, "votes before play") ---------------------------------------------------------

// docs/48 A4: the polls are the second tab of Admin → News & polls
const POLLS = "/admin/news?tab=polls";
const pollBack = (msg: string) => `${POLLS}&poll=${encodeURIComponent(msg)}#polls`;
/** A problem with the New poll form reopens it (it is shown only after "New poll" is pressed); an edit's goes to the list. */
const formBack = (formData: FormData, msg: string) => (formData.get("form") === "new" ? `${POLLS}&new=1&poll=${encodeURIComponent(msg)}#new-poll` : pollBack(msg));

/** The form's option rows (text, picture, link or mod, and for an edit the option's id), in order. Stops at a bad picture. */
async function readRows(formData: FormData): Promise<EditRow[]> {
  const rows: EditRow[] = [];
  for (let i = 1; i <= MAX_OPTIONS; i++) {
    const id = String(formData.get(`id${i}`) ?? "") || null;
    const text = String(formData.get(`option${i}`) ?? "");
    const link = String(formData.get(`link${i}`) ?? "");
    const modId = String(formData.get(`mod${i}`) ?? "");
    const pic = formData.get(`image${i}`);
    let image: string | null = null;
    if (pic instanceof File && pic.size > 0 && (text.trim() || modId)) {
      // a picture without an option is dropped with its empty row
      const stored = await storePhoto(pic);
      if (!stored.ok) redirect(formBack(formData, `Option ${i}: ${stored.reason}`));
      image = stored.file;
    }
    // a mod option with no text of its own is called by the mod's name
    let label = text;
    if (!label.trim() && modId) {
      try {
        label = modBySlug(await getManifest()).get(modId)?.name ?? "";
      } catch {}
      if (!label) redirect(formBack(formData, `Option ${i}: that mod isn't in mods.json.`));
    }
    rows.push({ id, text: label, link, modId, image });
  }
  return rows;
}

function readQuestion(formData: FormData): string {
  const question = String(formData.get("question") ?? "").replace(/[\r\n]+/g, " ").trim();
  if (question.length < 3 || question.length > 160) redirect(formBack(formData, "Give the poll a question (3 to 160 characters)."));
  return question;
}

function readCloses(formData: FormData): Date | null {
  const closesRaw = String(formData.get("closesAt") ?? "").trim();
  const closesAt = closesRaw ? ukLocalToDate(closesRaw) : null;
  if (closesRaw && (!closesAt || closesAt.getTime() <= Date.now() + 60_000)) redirect(formBack(formData, "The closing date must be in the future (UK time)."));
  return closesAt;
}

function pollsChanged() {
  revalidatePath("/admin/news");
  revalidatePath("/votes");
  revalidatePath("/");
}

/** New poll: the question, 2 to 8 options (text, optional picture, link or mod), single or multiple, a closing date, must vote. Opened at once. */
export async function createPollAction(formData: FormData) {
  const admin = await requireAdmin();
  const question = readQuestion(formData);
  const made = makeOptions(await readRows(formData));
  if (!made.ok) redirect(formBack(formData, made.reason));
  const closesAt = readCloses(formData);
  await openPoll({ id: admin.id, role: "ADMIN" }, { question, options: made.options, multiple: formData.get("multiple") === "on", mustVote: formData.get("mustVote") === "on", closesAt });
  pollsChanged();
  redirect(pollBack("opened"));
}

/** Edit an open poll (Alex, 2026-10-06): votes already cast stay with their option. */
export async function editPollAction(id: string, formData: FormData) {
  const admin = await requireAdmin();
  const question = readQuestion(formData);
  const rows = await readRows(formData);
  const closesAt = readCloses(formData);
  const r = await editPoll({ id: admin.id, role: "ADMIN" }, id, { question, rows, multiple: formData.get("multiple") === "on", mustVote: formData.get("mustVote") === "on", closesAt });
  if (!r.ok) redirect(pollBack(r.reason));
  pollsChanged();
  redirect(pollBack(r.changed ? "edited" : "unchanged"));
}

/** Must vote before playing, on an open poll: on or off. */
export async function pollMustVoteAction(id: string, on: boolean) {
  const admin = await requireAdmin();
  await setPollMustVote({ id: admin.id, role: "ADMIN" }, id, on);
  pollsChanged();
  redirect(pollBack(on ? "must-vote" : "optional"));
}

export async function closePollAction(id: string) {
  const admin = await requireAdmin();
  await closePoll({ id: admin.id, role: "ADMIN" }, id);
  revalidatePath("/admin/news");
  revalidatePath("/votes");
  redirect(pollBack("closed"));
}

export async function deletePollAction(id: string) {
  const admin = await requireAdmin();
  await deletePoll({ id: admin.id, role: "ADMIN" }, id);
  revalidatePath("/admin/news");
  revalidatePath("/votes");
  redirect(pollBack("deleted"));
}

/** The season's mod ballot can be a must-vote too: answered before playing, like a poll. */
export async function ballotMustVoteAction(id: string, on: boolean) {
  const admin = await requireAdmin();
  const vote = await db.vote.findUnique({ where: { id }, select: { title: true } });
  if (!vote) redirect("/admin/pack?tab=modvote");
  await db.vote.update({ where: { id }, data: { mustVote: on } });
  await audit({ userId: admin.id, action: "vote.mustVote", params: { voteId: id, title: vote.title, on }, result: "OK" });
  revalidatePath("/admin/pack");
  redirect("/admin/pack?tab=modvote");
}
