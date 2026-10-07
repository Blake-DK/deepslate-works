import { compileGrid, DesignError, parseRecipe, type BlockList, type Recipe } from "modpack/design";

// docs/39 Step 2: what the build designer's answer means for the page, and how a design's versions are kept. Pure, so
// the tests can run it; the calls and the files are in src/server/designer.ts.

export const DESIGN_NAME = /^[a-z0-9_]{2,24}$/;
export const MAX_ASK = 2000;

export type DesignTokens = { input: number; cacheWrite: number; cacheRead: number; output: number };
export type DesignVersion = { n: number; at: string; ask: string; say: string; recipe: Recipe; ms: number; tokens: DesignTokens; fixed: boolean };
/** data/builds/designs/<name>.json: every version, which one is current, and which one was kept as an upload. */
export type DesignFile = { name: string; current: number; versions: DesignVersion[]; kept: { version: number; at: string } | null };
export type DesignSummary = { name: string; versions: number; current: number; kept: number | null; at: string };

/**
 * The designer's text read: a recipe that passes our checks ("build"), one that does not ("refused", with the reason,
 * to send back once), or no recipe at all ("none": the refusal line, or text that is not the one JSON object asked
 * for). The admin's name for the build always wins over the one in the recipe.
 */
export type Answer =
  | { kind: "build"; say: string; recipe: Recipe }
  | { kind: "refused"; say: string; reason: string; recipe: unknown }
  | { kind: "none"; text: string };

export function readAnswer(text: string, name: string, blocks: BlockList): Answer {
  let body = text.trim();
  // asked for no fence; a fence round the one object is still that object
  const fenced = /^```(?:json)?\s*\n([\s\S]*)\n```$/.exec(body);
  if (fenced) body = fenced[1]!.trim();
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    return { kind: "none", text: text.slice(0, 4000) };
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { kind: "none", text: text.slice(0, 4000) };
  const o = v as { say?: unknown; recipe?: unknown };
  const say = typeof o.say === "string" ? o.say.slice(0, 2000) : "";
  if (!o.recipe || typeof o.recipe !== "object" || Array.isArray(o.recipe)) return { kind: "none", text: say || text.slice(0, 4000) };
  const raw = { ...(o.recipe as Record<string, unknown>), name };
  try {
    const recipe = parseRecipe(raw, blocks);
    compileGrid(recipe, blocks); // the block count and the writes are only known once it is built
    return { kind: "build", say, recipe };
  } catch (e) {
    if (e instanceof DesignError) return { kind: "refused", say, reason: e.message, recipe: raw };
    throw e;
  }
}

/** What goes back to the designer, once, when its recipe was refused. */
export const fixAsk = (reason: string) => `The recipe you returned was refused by the checks: ${reason}. Fix that, keep everything else, and return the whole recipe.`;

/** A design with a new version, which becomes the current one. */
export function withVersion(design: DesignFile | null, name: string, v: Omit<DesignVersion, "n">): DesignFile {
  const versions = design?.versions ?? [];
  const n = versions.reduce((m, x) => Math.max(m, x.n), 0) + 1;
  return { name, current: n, versions: [...versions, { ...v, n }], kept: design?.kept ?? null };
}

export const currentVersion = (d: DesignFile): DesignVersion => d.versions.find((v) => v.n === d.current) ?? d.versions[d.versions.length - 1]!;

export function summary(d: DesignFile): DesignSummary {
  const last = d.versions[d.versions.length - 1];
  return { name: d.name, versions: d.versions.length, current: d.current, kept: d.kept?.version ?? null, at: last?.at ?? "" };
}

/** Calls in the last hour and the last day against the limits: what to say when one is used up, or null. */
export function overLimit(lastHour: number, lastDay: number, daily: number, hourly = 30): string | null {
  if (lastDay >= daily) return `The designer has been asked ${lastDay} times today, the most for a day (DESIGNER_DAILY). It counts against the same plan as everything else; try again tomorrow.`;
  if (lastHour >= hourly) return `The designer has been asked ${lastHour} times in the last hour, the most for an hour. Try again later.`;
  return null;
}
