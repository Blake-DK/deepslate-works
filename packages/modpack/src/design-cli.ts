import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeNbt } from "./nbt";
import { blockCounts, blockListText, DesignError, parseRecipe, picture, renderTurns, type BlockList } from "./design";
import { compile } from "./design-nbt";

// docs/39 Step 0: `modpack design <file>` and `modpack design-prompt`, to prove the recipe compiler and the designer
// from a terminal before any page is built.

export async function loadBlockList(modpackRoot: string): Promise<BlockList> {
  return JSON.parse(await readFile(path.join(modpackRoot, "designer", "blocks.json"), "utf8")) as BlockList;
}

/**
 * The designer's whole system prompt: its instructions (tools/designer/instructions.md, out of web's reach, docs/39
 * Step 1), then the block list. tools/designer/server.mjs makes the same text for each call.
 */
export async function designPrompt(paths: { root: string; repo: string }): Promise<string> {
  const instructions = await readFile(path.join(paths.repo, "tools", "designer", "instructions.md"), "utf8");
  return `${instructions.trimEnd()}\n\n${blockListText(await loadBlockList(paths.root))}`;
}

/**
 * The recipe in a file: a recipe on its own, the designer's answer ({"say", "recipe"}) or the command's whole JSON
 * output with the answer as text in "result". Returns the recipe and the designer's words, if any.
 */
export function recipeFrom(text: string): { recipe: unknown; say?: string } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new DesignError("the file is not JSON");
  }
  if (v && typeof v === "object" && "result" in v && typeof v.result === "string") return recipeFrom(v.result);
  if (v && typeof v === "object" && "recipe" in v) return { recipe: v.recipe, say: "say" in v && typeof v.say === "string" ? v.say : undefined };
  if (v && typeof v === "object" && "say" in v && typeof v.say === "string") throw new DesignError(`the designer did not return a build: ${v.say}`);
  return { recipe: v };
}

/** A recipe file into <out>/<name>.nbt, <name>.png (four turns) and <name>-inside.png (cut above the walking floor). */
export async function designFile(file: string, out: string, modpackRoot: string, log: (s: string) => void): Promise<void> {
  const blocks = await loadBlockList(modpackRoot);
  const { recipe: raw, say } = recipeFrom(await readFile(file, "utf8"));
  const started = Date.now();
  const recipe = parseRecipe(raw, blocks);
  const { structure, grid, blocks: count } = compile(recipe, blocks);
  const ms = Date.now() - started;
  await mkdir(out, { recursive: true });
  const nbt = path.join(out, `${recipe.name}.nbt`);
  await writeFile(nbt, writeNbt(structure));

  const { x, y, z } = recipe.size;
  const tile = Math.min(32, Math.max(4, Math.floor(1000 / (x + z) / 2) * 2));
  const sharp = (await import("sharp")).default;
  const png = async (name: string, cut?: number) => {
    const img = renderTurns(picture(grid, blocks, cut), tile);
    await sharp(Buffer.from(img.rgba.buffer, img.rgba.byteOffset, img.rgba.byteLength), { raw: { width: img.width, height: img.height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(out, name));
  };
  await png(`${recipe.name}.png`);
  await png(`${recipe.name}-inside.png`, recipe.ground + 2);

  if (say) log(`designer: ${say}`);
  log(`${recipe.name}: ${x} by ${y} by ${z}, ground ${recipe.ground}, ${count.toLocaleString("en-GB")} blocks (compiled in ${ms} ms)`);
  for (const c of blockCounts(grid)) log(`  ${String(c.count).padStart(7)}  ${c.block}`);
  for (const m of recipe.markers ?? []) log(`  marker ${m.name} at ${m.at.join(", ")}${m.note ? `: ${m.note}` : ""}`);
  log(`wrote ${nbt}, ${recipe.name}.png and ${recipe.name}-inside.png`);
}
