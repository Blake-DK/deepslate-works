"use server";
import { revalidatePath } from "next/cache";
import { compileGrid, parseRecipe } from "modpack/design";
import { gridToStructure } from "modpack/design-nbt";
import { writeNbt } from "modpack/nbt";
import { env } from "@/env";
import { requireAdmin } from "@/server/auth/session";
import { audit } from "@/server/events";
import { listBuilds, storeBuild } from "@/server/builds";
import { askDesigner, designCalls, designerSetUp, isDesignerOwner, loadBlockList, readDesign, writeDesign } from "@/server/designer";
import { currentVersion, DESIGN_NAME, fixAsk, MAX_ASK, overLimit, readAnswer, withVersion, type DesignFile } from "@/lib/designer";

// docs/39 Step 2: the "Design a build" card. Called from the card itself (not a form post), so each answer comes back
// to the page as data. Owner only on the plan's login; every call to the designer is a `build.design` event, which is
// also what the hourly and daily limits count.

export type DesignResult = { ok: true; design: DesignFile; note?: string } | { ok: false; error: string; text?: string; design?: DesignFile | null };

async function owner() {
  const admin = await requireAdmin();
  if (!isDesignerOwner(admin)) return { admin, error: "Only the owner can use the designer." };
  if (!designerSetUp()) return { admin, error: "The designer is not set up (DESIGNER_URL and DESIGNER_TOKEN, docs/39)." };
  return { admin, error: null };
}

/**
 * A new design (`fresh`) or a change to the current version of one. The answer is checked by our own code; a recipe
 * that does not pass goes back to the designer once with the reason, and a second failure is shown as it is.
 */
export async function designAction(input: { name: string; ask: string; fresh: boolean }): Promise<DesignResult> {
  const { admin, error } = await owner();
  if (error) return { ok: false, error };
  const name = String(input.name ?? "").trim();
  const ask = String(input.ask ?? "").trim();
  if (!DESIGN_NAME.test(name)) return { ok: false, error: "The name is 2 to 24 small letters, digits or _." };
  if (!ask) return { ok: false, error: input.fresh ? "Say what it should be." : "Say what should change." };
  if (ask.length > MAX_ASK) return { ok: false, error: `At most ${MAX_ASK} characters.` };

  const existing = await readDesign(name);
  if (input.fresh && existing) return { ok: false, error: `There is a design called ${name} already: open it from the list, or pick another name.`, design: existing };
  if (!input.fresh && !existing) return { ok: false, error: `There is no design called ${name}.` };
  if (input.fresh && (await listBuilds()).some((b) => b.name === name)) return { ok: false, error: `An upload is already called ${name}. Keeping this design would replace it, so pick another name.` };

  const calls = await designCalls();
  const limit = overLimit(calls.hour, calls.day, env.DESIGNER_DAILY);
  if (limit) return { ok: false, error: limit, design: existing };

  const blocks = await loadBlockList();
  const base = existing ? currentVersion(existing).recipe : null;
  const call = async (words: string, recipe: unknown, retry: boolean) => {
    const r = await askDesigner({ name, ask: words, recipe });
    const answer = r.ok ? readAnswer(r.text, name, blocks) : null;
    await audit({
      userId: admin.id,
      action: "build.design",
      params: { name, ask: ask.slice(0, 300), fresh: input.fresh, retry, ms: r.ok ? r.ms : null, tokensOut: r.ok ? r.tokens.output : null, passed: answer?.kind === "build", why: r.ok ? (answer?.kind === "refused" ? answer.reason : answer?.kind === "none" ? "no recipe" : null) : r.error },
      result: r.ok ? (answer?.kind === "build" ? "OK" : "FAILED") : "FAILED",
    });
    return { r, answer };
  };

  let { r, answer } = await call(ask, base, false);
  let fixed = false;
  if (r.ok && answer?.kind === "refused") {
    ({ r, answer } = await call(fixAsk(answer.reason), answer.recipe, true));
    fixed = true;
  }
  if (!r.ok) return { ok: false, error: r.error, design: existing };
  if (!answer || answer.kind === "none") return { ok: false, error: "The designer did not return a build.", text: answer?.text, design: existing };
  if (answer.kind === "refused") return { ok: false, error: `The designer's build did not pass our checks${fixed ? ", twice" : ""}: ${answer.reason}.`, text: answer.say, design: existing };

  const design = withVersion(existing, name, { at: new Date().toISOString(), ask, say: answer.say, recipe: answer.recipe, ms: r.ms, tokens: r.tokens, fixed });
  await writeDesign(design);
  revalidatePath("/admin/seasons");
  return { ok: true, design, note: fixed ? "Its first recipe did not pass our checks; it was sent back once and fixed." : undefined };
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
  revalidatePath("/admin/seasons");
  return { ok: true, design: next, note: `Kept as the upload ${design.name}.nbt (version ${v.n}). Press Build and Sync on the Modpack page to put it on the server.` };
}
