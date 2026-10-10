"use server";
import { revalidatePath } from "next/cache";
import { compileGrid, parseRecipe } from "modpack/design";
import { gridToStructure } from "modpack/design-nbt";
import { writeNbt } from "modpack/nbt";
import { env } from "@/env";
import { requireAdmin } from "@/server/auth/session";
import { audit } from "@/server/events";
import { listBuilds, storeBuild } from "@/server/builds";
import { askDesigner, designCalls, designerSetUp, isDesignerOwner, listDesigns, loadBlockList, readDesign, writeDesign } from "@/server/designer";
import { clearJobs, currentJob, startJob, type DesignJob, type JobOutcome, type JobStage } from "@/server/design-jobs";
import { currentVersion, DESIGN_NAME, designName, fixAsk, MAX_ASK, overLimit, readAnswer, titleOf, withVersion, type DesignFile } from "@/lib/designer";
import { ukDayTime } from "@/lib/uk-time";

// docs/39 Step 2, docs/40: the "Design a build" card. Called from the card itself (not a form post), so each answer
// comes back to the page as data. Owner only on the plan's login; every call to the designer is a `build.design`
// event, which is also what the hourly and daily limits count. Design and Change it start a job and answer at once
// (src/server/design-jobs.ts): the design carries on when the page is left.

export type DesignResult = { ok: true; design: DesignFile; note?: string } | { ok: false; error: string; text?: string; design?: DesignFile | null };
export type StartResult = { ok: true; job: DesignJob } | { ok: false; error: string; design?: DesignFile | null };

async function owner() {
  const admin = await requireAdmin();
  if (!isDesignerOwner(admin)) return { admin, error: "Only the owner can use the designer." };
  if (!designerSetUp()) return { admin, error: "The designer is not set up (DESIGNER_URL and DESIGNER_TOKEN, docs/39)." };
  return { admin, error: null };
}

/**
 * A new design (`fresh`, under any name: docs/40 Part 1) or a change to the current version of one. The checks run
 * here; the call, the one send-back, the check of the answer and the new version run on as a job.
 */
export async function designAction(input: { name: string; ask: string; fresh: boolean }): Promise<StartResult> {
  const { admin, error } = await owner();
  if (error) return { ok: false, error };
  const ask = String(input.ask ?? "").trim();
  if (!ask) return { ok: false, error: input.fresh ? "Say what it should be." : "Say what should change." };
  if (ask.length > MAX_ASK) return { ok: false, error: `At most ${MAX_ASK} characters.` };

  const running = await currentJob();
  if (running && !running.failed) return { ok: false, error: `The designer is working on ${running.name}, started ${ukDayTime(new Date(running.startedAt))}.` };

  let name: string;
  let existing: DesignFile | null = null;
  const typed = String(input.name ?? "");
  if (input.fresh) {
    const taken = new Set([...(await listDesigns()).map((d) => d.name), ...(await listBuilds()).map((b) => b.name)]);
    name = designName(typed, ask, taken);
  } else {
    name = typed.trim();
    if (!DESIGN_NAME.test(name)) return { ok: false, error: "No such design." };
    existing = await readDesign(name);
    if (!existing) return { ok: false, error: `There is no design called ${name}.` };
  }

  const calls = await designCalls();
  const limit = overLimit(calls.hour, calls.day, env.DESIGNER_DAILY);
  if (limit) return { ok: false, error: limit, design: existing };

  const title = input.fresh ? titleOf(typed) : existing?.title;
  const job = await startJob({ name, ...(title ? { title } : {}), ask, fresh: input.fresh, by: admin.id }, (stage) => designWork({ adminId: admin.id, name, title, ask, fresh: input.fresh, existing }, stage));
  return { ok: true, job };
}

/** The work of one job: the call, sent back once when our checks refuse its recipe, then the version written. */
async function designWork(j: { adminId: string; name: string; title?: string; ask: string; fresh: boolean; existing: DesignFile | null }, stage: (s: JobStage) => Promise<void>): Promise<JobOutcome> {
  const blocks = await loadBlockList();
  const base = j.existing ? currentVersion(j.existing).recipe : null;
  const call = async (words: string, recipe: unknown, retry: boolean) => {
    const r = await askDesigner({ name: j.name, ask: words, recipe });
    if (r.ok) await stage("checking");
    const answer = r.ok ? readAnswer(r.text, j.name, blocks) : null;
    await audit({
      userId: j.adminId,
      action: "build.design",
      params: { name: j.name, ask: j.ask.slice(0, 300), fresh: j.fresh, retry, ms: r.ok ? r.ms : null, tokensOut: r.ok ? r.tokens.output : null, passed: answer?.kind === "build", why: r.ok ? (answer?.kind === "refused" ? answer.reason : answer?.kind === "none" ? "no recipe" : null) : r.error },
      result: r.ok ? (answer?.kind === "build" ? "OK" : "FAILED") : "FAILED",
    });
    return { r, answer };
  };

  let { r, answer } = await call(j.ask, base, false);
  let fixed = false;
  if (r.ok && answer?.kind === "refused") {
    await stage("fixing");
    ({ r, answer } = await call(fixAsk(answer.reason), answer.recipe, true));
    fixed = true;
  }
  if (!r.ok) return { ok: false, error: r.error };
  if (!answer || answer.kind === "none") return { ok: false, error: "The designer did not return a build.", text: answer?.text };
  if (answer.kind === "refused") return { ok: false, error: `The designer's build did not pass our checks${fixed ? ", twice" : ""}: ${answer.reason}.`, text: answer.say };

  // read again: a Back or a Keep pressed while it was designing must not be undone by writing an old copy
  const now = await readDesign(j.name);
  const design = withVersion(now ?? j.existing, j.name, { at: new Date().toISOString(), ask: j.ask, say: answer.say, ...(answer.plan.length ? { plan: answer.plan } : {}), recipe: answer.recipe, ms: r.ms, tokens: r.tokens, fixed }, j.title);
  await writeDesign(design);
  return { ok: true };
}

/** The job, for the card when the page is opened again ("Clear" after a failure is clearJobAction). */
export async function jobAction(): Promise<{ job: DesignJob | null }> {
  const { error } = await owner();
  return { job: error ? null : await currentJob() };
}

/** "Clear": a failed job the owner has read goes away. A running one is not touched. */
export async function clearJobAction(): Promise<{ ok: boolean }> {
  const { error } = await owner();
  if (error) return { ok: false };
  const job = await currentJob();
  if (job && !job.failed) return { ok: false };
  await clearJobs();
  return { ok: true };
}

export async function openDesignAction(name: string): Promise<DesignResult> {
  const { error } = await owner();
  if (error) return { ok: false, error };
  const design = await readDesign(String(name));
  return design ? { ok: true, design } : { ok: false, error: "No such design." };
}

/** "Back to version n": that version becomes the current one, which the next change starts from. */
export async function designBackAction(name: string, n: number): Promise<DesignResult> {
  const { error } = await owner();
  if (error) return { ok: false, error };
  const design = await readDesign(String(name));
  if (!design || !design.versions.some((v) => v.n === n)) return { ok: false, error: "No such version." };
  const next = { ...design, current: n };
  await writeDesign(next);
  return { ok: true, design: next };
}

/** "Keep this build": the current version compiled and stored as an ordinary upload, <name>.nbt (docs/37's check). */
export async function designKeepAction(name: string): Promise<DesignResult> {
  const { admin, error } = await owner();
  if (error) return { ok: false, error };
  const design = await readDesign(String(name));
  if (!design) return { ok: false, error: "No such design." };
  const v = currentVersion(design);
  const blocks = await loadBlockList();
  let bytes: Buffer;
  try {
    bytes = writeNbt(gridToStructure(compileGrid(parseRecipe(v.recipe, blocks), blocks)));
  } catch (e) {
    return { ok: false, error: `It does not compile any more (the block list may have changed): ${e instanceof Error ? e.message : String(e)}`, design };
  }
  const stored = await storeBuild(design.name, new File([new Uint8Array(bytes)], `${design.name}.nbt`));
  if (!stored.ok) return { ok: false, error: stored.reason, design };
  const next: DesignFile = { ...design, kept: { version: v.n, at: new Date().toISOString() } };
  await writeDesign(next);
  const { check } = stored.build.note!;
  await audit({ userId: admin.id, action: "build.design.keep", params: { name: design.name, version: v.n, size: `${check.size.x}x${check.size.y}x${check.size.z}`, blocks: check.blocks }, result: "OK" });
  revalidatePath("/admin/builds");
  return { ok: true, design: next, note: `Kept as the upload ${design.name}.nbt (version ${v.n}). Press Build and Sync on the Modpack page to put it on the server.` };
}
