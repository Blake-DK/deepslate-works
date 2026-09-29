"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { closeVote, tallyVote } from "@/server/vote/votes";
import { getManifest, votableMods, writeManifest, commitManifest } from "@/server/modpack/manifest";
import { decide } from "@/server/vote/tally";
import { audit } from "@/server/events";

export async function closeVoteAction(formData: FormData) {
  const admin = await requireAdmin();
  const voteId = String(formData.get("voteId") ?? "");
  await closeVote(voteId, admin.id);
  revalidatePath("/vote/results");
  redirect("/vote/results");
}

export async function applyResultsAction(formData: FormData) {
  const admin = await requireAdmin();
  const voteId = String(formData.get("voteId") ?? "");
  const threshold = Math.min(100, Math.max(1, Number(formData.get("threshold") ?? 50) || 50));
  const vote = await db.vote.findUnique({ where: { id: voteId } });
  if (!vote || vote.status !== "CLOSED") redirect("/vote/results?applied=not-closed");
  const manifest = await getManifest();
  const t = await tallyVote(vote);
  const decisions = decide(votableMods(manifest), t, threshold);
  const changes = decisions.filter((d) => d.from !== d.to);
  if (changes.length === 0) redirect("/vote/results?applied=nothing");
  const to = new Map(changes.map((d) => [d.slug, d.to]));
  const next = { ...manifest, mods: manifest.mods.map((m) => (to.has(m.slug) ? { ...m, enabled: to.get(m.slug)! } : m)) };
  await writeManifest(next);
  const summary = changes.map((d) => `${d.to ? "+" : "-"}${d.slug}`).join(" ");
  const commit = await commitManifest(`chore(modpack): apply "${vote.title}" results (${summary})`, { name: admin.displayName });
  await audit({ userId: admin.id, action: "vote.apply", params: { voteId, threshold, changes: summary }, result: commit.ok ? "OK" : "FAILED", detail: commit.ok ? null : commit.output.slice(0, 500) });
  revalidatePath("/mods");
  revalidatePath("/vote/results");
  redirect(commit.ok ? "/vote/results?applied=ok" : "/vote/results?applied=nocommit");
}
