import { z } from "zod";

// docs/39: the build designer. A recipe is a short list of shapes ("a hollow box of deepslate bricks from here to
// there, a dome on top, clear a doorway"); this file checks one (parseRecipe), turns it into the same structure file
// builds.ts writes (compile) and into the blocks a picture shows (picture, render). Nothing in a recipe becomes
// anything but blocks from modpack/designer/blocks.json, inside the size, within the limits below.
// This file runs in the browser too (the Builds page draws the picture there), so it imports nothing of node's: the
// structure file is written by design-nbt.ts.

/** The same rule as builds.ts's BUILD_NAME, kept here so this file needs nothing of node's. */
const BUILD_NAME = /^[a-z0-9_]{2,24}$/;

export const DESIGN_LIMITS = {
  side: 128,
  /** steps as written, the ones inside repeat and mirror counted too */
  steps: 300,
  /** steps after repeat and mirror are unrolled */
  unrolled: 5_000,
  /** places in the finished build (air written by clear counted too) */
  blocks: 500_000,
  /** the recipe as JSON */
  bytes: 64 * 1024,
  /** every block the steps write, one over another counted each time: keeps a recipe of many big boxes from taking minutes */
  writes: 20_000_000,
} as const;

export class DesignError extends Error {}

export type BlockKind = { props?: Record<string, string[]>; fixed?: Record<string, string> };
export type BlockList = { kinds: Record<string, BlockKind>; blocks: Array<{ id: string; colour: string; kind?: string }> };

const P = z.tuple([z.number().int(), z.number().int(), z.number().int()]);
type Point = z.infer<typeof P>;
const With = z.string().min(1).max(160);
const MATERIAL = /^[a-z][a-z0-9_]{0,23}$/;
const DIRS = ["north", "south", "east", "west"] as const;

type Step =
  | { op: "box"; from: Point; to: Point; with: string; hollow?: boolean }
  | { op: "walls"; from: Point; to: Point; with: string }
  | { op: "cylinder"; base: Point; radius: number; height: number; with: string; hollow?: boolean }
  | { op: "dome"; base: Point; radius: number; with: string; hollow?: boolean }
  | { op: "pyramid"; from: Point; to: Point; with: string; hollow?: boolean }
  | { op: "line"; from: Point; to: Point; with: string }
  | { op: "stairs"; from: Point; dir: (typeof DIRS)[number]; length: number; width: number; with: string }
  | { op: "set"; at: Point[]; with: string }
  | { op: "clear"; from: Point; to: Point }
  | { op: "repeat"; times: number; move: Point; steps: Step[] }
  | { op: "mirror"; axis: "x" | "z" | "both"; steps: Step[] };

const StepSchema: z.ZodType<Step> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("box"), from: P, to: P, with: With, hollow: z.boolean().optional() }).strict(),
    z.object({ op: z.literal("walls"), from: P, to: P, with: With }).strict(),
    z.object({ op: z.literal("cylinder"), base: P, radius: z.number().int().min(1).max(64), height: z.number().int().min(1).max(DESIGN_LIMITS.side), with: With, hollow: z.boolean().optional() }).strict(),
    z.object({ op: z.literal("dome"), base: P, radius: z.number().int().min(1).max(64), with: With, hollow: z.boolean().optional() }).strict(),
    z.object({ op: z.literal("pyramid"), from: P, to: P, with: With, hollow: z.boolean().optional() }).strict(),
    z.object({ op: z.literal("line"), from: P, to: P, with: With }).strict(),
    z.object({ op: z.literal("stairs"), from: P, dir: z.enum(DIRS), length: z.number().int().min(1).max(DESIGN_LIMITS.side), width: z.number().int().min(1).max(32), with: With }).strict(),
    z.object({ op: z.literal("set"), at: z.array(P).min(1).max(512), with: With }).strict(),
    z.object({ op: z.literal("clear"), from: P, to: P }).strict(),
    z.object({ op: z.literal("repeat"), times: z.number().int().min(1).max(DESIGN_LIMITS.side), move: P, steps: z.array(StepSchema).min(1) }).strict(),
    z.object({ op: z.literal("mirror"), axis: z.enum(["x", "z", "both"]), steps: z.array(StepSchema).min(1) }).strict(),
  ]),
);

const Side = z.number().int().min(1).max(DESIGN_LIMITS.side);
const RecipeSchema = z.object({
  name: z.string().regex(BUILD_NAME, "a-z, 0-9 and _, 2 to 24 characters"),
  size: z.object({ x: Side, y: Side, z: Side }).strict(),
  ground: z.number().int().min(0),
  seed: z.number().int().optional(),
  materials: z.record(z.string().regex(MATERIAL, "a material's name is a-z, 0-9 and _, starting with a letter"), z.union([With, z.array(z.tuple([With, z.number().int().min(1).max(1000)])).min(1).max(16)])).optional(),
  steps: z.array(StepSchema).min(1),
  markers: z.array(z.object({ name: z.string().min(1).max(40), at: P, note: z.string().max(200).optional() }).strict()).max(50).optional(),
}).strict();

export type Recipe = z.infer<typeof RecipeSchema>;
export type Marker = NonNullable<Recipe["markers"]>[number];

/** "steps.3.steps.0.from" as "step 4.1, from". */
function where(path: Array<string | number>): string {
  const steps: number[] = [];
  const rest: Array<string | number> = [];
  for (let i = 0; i < path.length; i++) {
    if (path[i] === "steps" && typeof path[i + 1] === "number" && rest.length === 0) {
      steps.push((path[i + 1] as number) + 1);
      i++;
    } else rest.push(path[i]!);
  }
  const head = steps.length ? `step ${steps.join(".")}` : "";
  const tail = rest.join(".");
  return [head, tail].filter(Boolean).join(", ") || "the recipe";
}

/** A block as written in a recipe, checked against the list: "minecraft:lantern[hanging=true]". */
type Block = { id: string; props: Record<string, string>; state: string };

function blockOf(text: string, blocks: BlockList): Block {
  const m = /^([a-z0-9_.-]+:[a-z0-9_./-]+)(?:\[([^\]]*)\])?$/.exec(text.trim());
  if (!m) throw new DesignError(`"${text.slice(0, 60)}" is not a block id`);
  const entry = blocks.blocks.find((b) => b.id === m[1]);
  if (!entry) throw new DesignError(`${m[1]} is not on the block list`);
  const kind = blocks.kinds[entry.kind ?? ""] ?? {};
  const props: Record<string, string> = {};
  for (const part of (m[2] ?? "").split(",").filter((p) => p.trim())) {
    const [k, v] = part.split("=").map((s) => s.trim());
    const allowed = k ? kind.props?.[k] : undefined;
    if (!k || v === undefined || !allowed) throw new DesignError(`${entry.id} has no property "${k ?? part}"${kind.props ? ` (it takes ${Object.keys(kind.props).join(", ")})` : " (it takes none)"}`);
    if (!allowed.includes(v)) throw new DesignError(`${entry.id}[${k}=${v}]: ${k} is one of ${allowed.join(", ")}`);
    props[k] = v;
  }
  Object.assign(props, kind.fixed ?? {});
  return blockAt(entry.id, props);
}

const blockAt = (id: string, props: Record<string, string>): Block => {
  const keys = Object.keys(props).sort();
  return { id, props, state: keys.length ? `${id}[${keys.map((k) => `${k}=${props[k]}`).join(",")}]` : id };
};

/** What a step writes with: one block, or a weighted mix picked per place. */
type Paint = { choices: Array<{ block: Block; weight: number }>; total: number };

function paintOf(withText: string, recipe: Recipe, blocks: BlockList): Paint {
  if (!withText.includes(":")) {
    const m = recipe.materials?.[withText];
    if (m === undefined) throw new DesignError(`uses the material "${withText}", which is not in materials`);
    if (typeof m === "string") return { choices: [{ block: blockOf(m, blocks), weight: 1 }], total: 1 };
    const choices = m.map(([b, weight]) => ({ block: blockOf(b, blocks), weight }));
    return { choices, total: choices.reduce((n, c) => n + c.weight, 0) };
  }
  return { choices: [{ block: blockOf(withText, blocks), weight: 1 }], total: 1 };
}

const kindOf = (id: string, blocks: BlockList) => blocks.kinds[blocks.blocks.find((b) => b.id === id)?.kind ?? ""] ?? {};

/** The same paint with these properties set wherever the block takes them (a stair's facing). */
function withProps(paint: Paint, set: Record<string, string>, blocks: BlockList): Paint {
  return {
    total: paint.total,
    choices: paint.choices.map(({ block, weight }) => {
      const takes = kindOf(block.id, blocks).props ?? {};
      const extra = Object.fromEntries(Object.entries(set).filter(([k, v]) => takes[k]?.includes(v)));
      return { block: blockAt(block.id, { ...block.props, ...extra }), weight };
    }),
  };
}

const FLIP: Record<"x" | "z", Record<string, string>> = { x: { east: "west", west: "east" }, z: { north: "south", south: "north" } };

/** The paint as its mirror image shows it: a stair facing east faces west in the mirror about x. */
function flipped(paint: Paint, axis: "x" | "z"): Paint {
  return {
    total: paint.total,
    choices: paint.choices.map(({ block, weight }) => {
      const facing = block.props.facing;
      return { block: facing && FLIP[axis][facing] ? blockAt(block.id, { ...block.props, facing: FLIP[axis][facing]! }) : block, weight };
    }),
  };
}

const DIR: Record<(typeof DIRS)[number], { step: Point; side: Point }> = {
  north: { step: [0, 0, -1], side: [1, 0, 0] },
  south: { step: [0, 0, 1], side: [1, 0, 0] },
  east: { step: [1, 0, 0], side: [0, 0, 1] },
  west: { step: [-1, 0, 0], side: [0, 0, 1] },
};

/** The box a step covers (before its offset): repeat and mirror have none of their own. */
function reach(s: Step): { lo: Point; hi: Point } | null {
  const box = (a: Point, b: Point) => ({ lo: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])] as Point, hi: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])] as Point });
  switch (s.op) {
    case "box": case "walls": case "pyramid": case "line": case "clear": return box(s.from, s.to);
    case "cylinder": return box([s.base[0] - s.radius, s.base[1], s.base[2] - s.radius], [s.base[0] + s.radius, s.base[1] + s.height - 1, s.base[2] + s.radius]);
    case "dome": return box([s.base[0] - s.radius, s.base[1], s.base[2] - s.radius], [s.base[0] + s.radius, s.base[1] + s.radius, s.base[2] + s.radius]);
    case "stairs": {
      const d = DIR[s.dir];
      const end: Point = [s.from[0] + d.step[0] * (s.length - 1) + d.side[0] * (s.width - 1), s.from[1] + s.length - 1, s.from[2] + d.step[2] * (s.length - 1) + d.side[2] * (s.width - 1)];
      return box(s.from, end);
    }
    case "set": return s.at.reduce<{ lo: Point; hi: Point } | null>((acc, p) => (acc ? box(box(acc.lo, p).lo, box(acc.hi, p).hi) : box(p, p)), null);
    default: return null;
  }
}

/**
 * A recipe as text (the designer's answer) or as parsed JSON, checked: its shape, every block on the list, every
 * material named, every step inside the size, the limits. Throws DesignError naming the first thing wrong, in words
 * that can be sent back to the designer ("step 14 reaches outside the size: x goes to 41, the size is 41 (0 to 40)").
 */
export function parseRecipe(input: string | unknown, blocks: BlockList): Recipe {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  if (new TextEncoder().encode(text).length > DESIGN_LIMITS.bytes) throw new DesignError(`the recipe is larger than ${DESIGN_LIMITS.bytes / 1024} KB`);
  let raw: unknown = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new DesignError("the recipe is not JSON");
    }
  }
  const parsed = RecipeSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0]!;
    throw new DesignError(`${where(i.path)}: ${i.message}`);
  }
  const recipe = parsed.data;
  if (recipe.ground >= recipe.size.y) throw new DesignError(`ground is ${recipe.ground}, but the build is only ${recipe.size.y} high (0 to ${recipe.size.y - 1})`);

  // the blocks and materials, each once
  for (const [name, m] of Object.entries(recipe.materials ?? {})) {
    try {
      for (const b of typeof m === "string" ? [m] : m.map(([id]) => id)) blockOf(b, blocks);
    } catch (e) {
      throw new DesignError(`material "${name}": ${(e as Error).message}`);
    }
  }

  let written = 0;
  let unrolled = 0;
  const walk = (steps: Step[], label: string, offsets: Point[]) => {
    steps.forEach((s, i) => {
      const name = `step ${label}${i + 1}`;
      written++;
      if (written > DESIGN_LIMITS.steps) throw new DesignError(`the recipe has more than ${DESIGN_LIMITS.steps} steps; use repeat and mirror`);
      if (s.op === "repeat") {
        const next: Point[] = [];
        for (const o of offsets) for (let t = 0; t < s.times; t++) next.push([o[0] + s.move[0] * t, o[1] + s.move[1] * t, o[2] + s.move[2] * t]);
        walk(s.steps, `${label}${i + 1}.`, next);
        return;
      }
      if (s.op === "mirror") {
        // the mirror image of a place inside the size is inside it too, so only the steps themselves are checked
        const copies = s.axis === "both" ? 4 : 2;
        const before = unrolled;
        walk(s.steps, `${label}${i + 1}.`, offsets);
        unrolled += (unrolled - before) * (copies - 1);
        if (unrolled > DESIGN_LIMITS.unrolled) throw new DesignError(`the recipe has more than ${DESIGN_LIMITS.unrolled.toLocaleString("en-GB")} steps once repeat and mirror are unrolled`);
        return;
      }
      if ("with" in s) {
        try {
          paintOf(s.with, recipe, blocks);
        } catch (e) {
          throw new DesignError(`${name}: ${(e as Error).message}`);
        }
      }
      const r = reach(s)!;
      for (const o of offsets) {
        unrolled++;
        if (unrolled > DESIGN_LIMITS.unrolled) throw new DesignError(`the recipe has more than ${DESIGN_LIMITS.unrolled.toLocaleString("en-GB")} steps once repeat and mirror are unrolled`);
        for (const [axis, k] of [["x", 0], ["y", 1], ["z", 2]] as const) {
          const lo = r.lo[k] + o[k];
          const hi = r.hi[k] + o[k];
          const max = recipe.size[axis];
          const copy = offsets.length > 1 || o.some((v) => v !== 0) ? ` (moved by ${o.join(", ")})` : "";
          if (lo < 0) throw new DesignError(`${name} reaches outside the size${copy}: ${axis} goes to ${lo}, the lowest is 0`);
          if (hi >= max) throw new DesignError(`${name} reaches outside the size${copy}: ${axis} goes to ${hi}, the size is ${max} (0 to ${max - 1})`);
        }
      }
    });
  };
  walk(recipe.steps, "", [[0, 0, 0]]);
  for (const m of recipe.markers ?? []) {
    const out = (["x", "y", "z"] as const).find((a, k) => m.at[k]! < 0 || m.at[k]! >= recipe.size[a]);
    if (out) throw new DesignError(`marker "${m.name}" is outside the size (${out})`);
  }
  return recipe;
}

/** The finished build as a grid: -1 where no step wrote, else an index into palette (0 is air, written by clear). */
export type DesignGrid = { size: Recipe["size"]; ground: number; palette: string[]; cells: Int32Array; markers: Marker[] };

/** A whole number from a place and the seed, the same every time: which block of a mix goes where. */
function hash(seed: number, x: number, y: number, z: number): number {
  let h = (seed ^ Math.imul(x, 73_856_093) ^ Math.imul(y, 19_349_663) ^ Math.imul(z, 83_492_791)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A checked recipe (parseRecipe first) as a grid of blocks. */
export function compileGrid(recipe: Recipe, blocks: BlockList): DesignGrid {
  const { x: sx, y: sy, z: sz } = recipe.size;
  const cells = new Int32Array(sx * sy * sz).fill(-1);
  const palette = ["minecraft:air"];
  const index = new Map<string, number>([["minecraft:air", 0]]);
  const seed = recipe.seed ?? 0;
  let writes = 0;

  type Put = (x: number, y: number, z: number, paint: Paint | null) => void;
  const write: Put = (x, y, z, paint) => {
    if (++writes > DESIGN_LIMITS.writes) throw new DesignError(`the recipe writes more than ${DESIGN_LIMITS.writes.toLocaleString("en-GB")} blocks, one over another; make it simpler`);
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return; // parseRecipe has refused this already
    let state = "minecraft:air";
    if (paint) {
      let r = paint.choices.length === 1 ? 0 : hash(seed, x, y, z) % paint.total;
      const c = paint.choices.find((ch) => (r -= ch.weight) < 0) ?? paint.choices[0]!;
      state = c.block.state;
    }
    let n = index.get(state);
    if (n === undefined) {
      n = palette.length;
      palette.push(state);
      index.set(state, n);
    }
    cells[x + sx * (z + sz * y)] = n;
  };

  const paints = new Map<string, Paint>();
  const paint = (w: string) => {
    let p = paints.get(w);
    if (!p) paints.set(w, (p = paintOf(w, recipe, blocks)));
    return p;
  };
  const range = (a: number, b: number) => [Math.min(a, b), Math.max(a, b)] as const;

  const run = (steps: Step[], put: Put, o: Point) => {
    for (const s of steps) {
      const at = (x: number, y: number, z: number, p: Paint | null) => put(x + o[0], y + o[1], z + o[2], p);
      switch (s.op) {
        case "box": case "walls": case "clear": {
          const p = s.op === "clear" ? null : paint(s.with);
          const [x0, x1] = range(s.from[0], s.to[0]);
          const [y0, y1] = range(s.from[1], s.to[1]);
          const [z0, z1] = range(s.from[2], s.to[2]);
          for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
            const side = x === x0 || x === x1 || z === z0 || z === z1;
            if (s.op === "walls" && !side) continue;
            if (s.op === "box" && s.hollow && !side && y !== y0 && y !== y1) continue;
            at(x, y, z, p);
          }
          break;
        }
        case "cylinder": {
          const p = paint(s.with);
          const r2 = (s.radius + 0.5) ** 2;
          const inside = (dx: number, dz: number) => dx * dx + dz * dz < r2;
          for (let dy = 0; dy < s.height; dy++) for (let dz = -s.radius; dz <= s.radius; dz++) for (let dx = -s.radius; dx <= s.radius; dx++) {
            if (!inside(dx, dz)) continue;
            if (s.hollow && inside(dx + 1, dz) && inside(dx - 1, dz) && inside(dx, dz + 1) && inside(dx, dz - 1)) continue;
            at(s.base[0] + dx, s.base[1] + dy, s.base[2] + dz, p);
          }
          break;
        }
        case "dome": {
          const p = paint(s.with);
          const r2 = (s.radius + 0.5) ** 2;
          const inside = (dx: number, dy: number, dz: number) => dy < 0 || dx * dx + dy * dy + dz * dz < r2;
          for (let dy = 0; dy <= s.radius; dy++) for (let dz = -s.radius; dz <= s.radius; dz++) for (let dx = -s.radius; dx <= s.radius; dx++) {
            if (!inside(dx, dy, dz)) continue;
            if (s.hollow && inside(dx + 1, dy, dz) && inside(dx - 1, dy, dz) && inside(dx, dy + 1, dz) && inside(dx, dy, dz + 1) && inside(dx, dy, dz - 1)) continue;
            at(s.base[0] + dx, s.base[1] + dy, s.base[2] + dz, p);
          }
          break;
        }
        case "pyramid": {
          const p = paint(s.with);
          const [x0, x1] = range(s.from[0], s.to[0]);
          const [y0, y1] = range(s.from[1], s.to[1]);
          const [z0, z1] = range(s.from[2], s.to[2]);
          for (let k = 0; y0 + k <= y1; k++) {
            const [a0, a1, b0, b1] = [x0 + k, x1 - k, z0 + k, z1 - k];
            if (a0 > a1 || b0 > b1) break;
            // the top layer (where it closes, or where the size stops it) is whole, so the roof is closed
            const top = y0 + k === y1 || a0 + 1 > a1 - 1 || b0 + 1 > b1 - 1;
            for (let z = b0; z <= b1; z++) for (let x = a0; x <= a1; x++) {
              if (s.hollow && !top && x !== a0 && x !== a1 && z !== b0 && z !== b1) continue;
              at(x, y0 + k, z, p);
            }
          }
          break;
        }
        case "line": {
          const p = paint(s.with);
          const d = [s.to[0] - s.from[0], s.to[1] - s.from[1], s.to[2] - s.from[2]];
          const n = Math.max(...d.map(Math.abs));
          for (let i = 0; i <= n; i++) {
            const t = n === 0 ? 0 : i / n;
            at(Math.round(s.from[0] + d[0]! * t), Math.round(s.from[1] + d[1]! * t), Math.round(s.from[2] + d[2]! * t), p);
          }
          break;
        }
        case "stairs": {
          const p = withProps(paint(s.with), { facing: s.dir, half: "bottom" }, blocks);
          const d = DIR[s.dir];
          for (let i = 0; i < s.length; i++) for (let j = 0; j < s.width; j++) {
            at(s.from[0] + d.step[0] * i + d.side[0] * j, s.from[1] + i, s.from[2] + d.step[2] * i + d.side[2] * j, p);
          }
          break;
        }
        case "set": {
          const p = paint(s.with);
          for (const q of s.at) at(q[0], q[1], q[2], p);
          break;
        }
        case "repeat":
          for (let t = 0; t < s.times; t++) run(s.steps, put, [o[0] + s.move[0] * t, o[1] + s.move[1] * t, o[2] + s.move[2] * t]);
          break;
        case "mirror": {
          // the steps write as usual and are written down; then each written place again, mirrored about the centre
          const done: Array<[number, number, number, Paint | null]> = [];
          run(s.steps, (x, y, z, p) => {
            done.push([x, y, z, p]);
            put(x, y, z, p);
          }, o);
          const axes: Array<Array<"x" | "z">> = s.axis === "both" ? [["x"], ["z"], ["x", "z"]] : [[s.axis]];
          const cache = new Map<Paint, Paint>();
          for (const flip of axes) {
            cache.clear();
            for (const [x, y, z, p] of done) {
              let q = p;
              if (p) {
                q = cache.get(p) ?? flip.reduce((acc, a) => flipped(acc, a), p);
                cache.set(p, q);
              }
              put(flip.includes("x") ? sx - 1 - x : x, y, flip.includes("z") ? sz - 1 - z : z, q);
            }
          }
          break;
        }
      }
    }
  };
  run(recipe.steps, write, [0, 0, 0]);

  let placed = 0;
  for (const c of cells) if (c >= 0) placed++;
  if (placed > DESIGN_LIMITS.blocks) throw new DesignError(`the build has ${placed.toLocaleString("en-GB")} blocks; the most is ${DESIGN_LIMITS.blocks.toLocaleString("en-GB")}`);
  if (placed === 0) throw new DesignError("the build has no blocks");
  return { size: recipe.size, ground: recipe.ground, palette, cells, markers: recipe.markers ?? [] };
}

/** How many of each block the build has (air left out), most first. */
export function blockCounts(grid: DesignGrid): Array<{ block: string; count: number }> {
  const n = new Array<number>(grid.palette.length).fill(0);
  for (const c of grid.cells) if (c > 0) n[c]!++;
  return grid.palette.map((block, i) => ({ block, count: n[i]! })).filter((e) => e.count > 0).sort((a, b) => b.count - a.count || a.block.localeCompare(b.block));
}

/** The blocks a picture shows: only those with a side open to the air, each with its colour. */
export type Picture = { size: Recipe["size"]; ground: number; colours: string[]; blocks: Array<[x: number, y: number, z: number, colour: number]>; markers: Marker[] };

const SEE_THROUGH_KINDS = new Set(["pane", "fence", "wall", "lantern", "wall_torch", "leaves", "stairs", "slab"]);
const SEE_THROUGH_IDS = /glass|grate|torch|chain|carpet/;

/**
 * The outer blocks of a grid with their colours. `cut` leaves out every layer above it, so the inside can be seen
 * floor by floor. A block counts as hidden only when all six of its neighbours are solid, whole blocks.
 */
export function picture(grid: DesignGrid, blocks: BlockList, cut = Infinity): Picture {
  const { x: sx, y: sy, z: sz } = grid.size;
  const colourOf = new Map(blocks.blocks.map((b) => [b.id, b.colour]));
  const idOf = (state: string) => state.replace(/\[.*$/, "");
  const solid = grid.palette.map((s, i) => {
    if (i === 0) return false;
    const id = idOf(s);
    const kind = blocks.blocks.find((b) => b.id === id)?.kind;
    return !(kind && SEE_THROUGH_KINDS.has(kind)) && !SEE_THROUGH_IDS.test(id);
  });
  const colours: string[] = [];
  const colourIndex = new Map<number, number>();
  const at = (x: number, y: number, z: number) => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz || y > cut ? -1 : grid.cells[x + sx * (z + sz * y)]!);
  const closed = (x: number, y: number, z: number) => {
    const c = at(x, y, z);
    return c > 0 && solid[c]!;
  };
  const out: Picture["blocks"] = [];
  for (let y = 0; y < Math.min(sy, cut + 1); y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const c = at(x, y, z);
    if (c <= 0) continue;
    if (closed(x + 1, y, z) && closed(x - 1, y, z) && closed(x, y + 1, z) && closed(x, y - 1, z) && closed(x, y, z + 1) && closed(x, y, z - 1)) continue;
    let k = colourIndex.get(c);
    if (k === undefined) {
      k = colours.length;
      colours.push(colourOf.get(idOf(grid.palette[c]!)) ?? "#ff00ff");
      colourIndex.set(c, k);
    }
    out.push([x, y, z, k]);
  }
  return { size: grid.size, ground: grid.ground, colours, blocks: out, markers: grid.markers };
}

/**
 * A picture drawn as an angled view into RGBA pixels: each block a small cube, top light, sides darker, seen from
 * above one corner. `turn` 0 to 3 walks the viewer a quarter round each time (0 looks from the south-east, so the
 * south and east faces show). The foundation, below `ground`, is drawn darker; markers are magenta dots.
 */
export function render(pic: Picture, opts: { turn?: number; tile?: number; background?: [number, number, number] } = {}): { width: number; height: number; rgba: Uint8ClampedArray } {
  const turn = (((opts.turn ?? 0) % 4) + 4) % 4;
  const w = Math.max(4, Math.floor((opts.tile ?? 8) / 2) * 2);
  const bg = opts.background ?? [30, 31, 36];
  const { x: sx0, y: sy, z: sz0 } = pic.size;
  const [sx, sz] = turn % 2 ? [sz0, sx0] : [sx0, sz0];
  const rot = (x: number, z: number): [number, number] =>
    turn === 0 ? [x, z] : turn === 1 ? [sz0 - 1 - z, x] : turn === 2 ? [sx0 - 1 - x, sz0 - 1 - z] : [z, sx0 - 1 - x];

  const width = (sx + sz) * (w / 2);
  const offX = (sz - 1) * (w / 2);
  const offY = (sy - 1) * (w / 2);
  const height = offY + (sx + sz - 2) * (w / 4) + w;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([bg[0], bg[1], bg[2], 255], i * 4);

  // the cube's pixels: 0 nothing, 1 top, 2 left (the south face at turn 0), 3 right (east); +4 on a face's edge
  const sprite = new Uint8Array(w * w);
  const inPoly = (px: number, py: number, poly: number[][]) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]!;
      const [xj, yj] = poly[j]!;
      if (yi! > py !== yj! > py && px < ((xj! - xi!) * (py - yi!)) / (yj! - yi!) + xi!) inside = !inside;
    }
    return inside;
  };
  const h = w / 2;
  const q = w / 4;
  const faces = [
    [[h, 0], [w, q], [h, h], [0, q]],
    [[0, q], [h, h], [h, w], [0, w - q]],
    [[h, h], [w, q], [w, w - q], [h, w]],
  ];
  for (let py = 0; py < w; py++) for (let px = 0; px < w; px++) {
    const f = faces.findIndex((poly) => inPoly(px + 0.5, py + 0.5, poly));
    sprite[py * w + px] = f + 1;
  }
  const face = (px: number, py: number) => (px < 0 || py < 0 || px >= w || py >= w ? 0 : sprite[py * w + px]!);
  const edged = Uint8Array.from(sprite, (f, i) => {
    if (!f) return 0;
    const px = i % w;
    const py = Math.floor(i / w);
    return [face(px + 1, py), face(px - 1, py), face(px, py + 1), face(px, py - 1)].some((g) => g !== f) ? f + 4 : f;
  });

  const rgb = pic.colours.map((c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)] as const);
  const shade = [0, 1, 0.78, 0.6];
  // painter's order: back to front, bottom to top
  const order = pic.blocks.map((b) => {
    const [x, z] = rot(b[0], b[2]);
    return [x, b[1], z, b[3]] as const;
  }).sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]) || a[1] - b[1]);
  for (const [x, y, z, c] of order) {
    const ox = (x - z) * (w / 2) + offX;
    const oy = (x + z) * (w / 4) - y * (w / 2) + offY;
    const base = rgb[c]!;
    const dim = y < pic.ground ? 0.62 : 1;
    for (let i = 0; i < w * w; i++) {
      const e = edged[i]!;
      if (!e) continue;
      const f = e > 4 ? e - 4 : e;
      const k = shade[f]! * dim * (e > 4 ? 0.82 : 1);
      const px = ox + (i % w);
      const py = oy + Math.floor(i / w);
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const at = (py * width + px) * 4;
      rgba[at] = base[0] * k;
      rgba[at + 1] = base[1] * k;
      rgba[at + 2] = base[2] * k;
    }
  }
  for (const m of pic.markers) {
    const [x, z] = rot(m.at[0], m.at[2]);
    const cx = (x - z) * (w / 2) + offX + w / 2;
    const cy = (x + z) * (w / 4) - m.at[1] * (w / 2) + offY + w / 4;
    const r = Math.max(2, w / 3);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = Math.round(cx + dx);
      const py = Math.round(cy + dy);
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const ring = dx * dx + dy * dy > (r - 1.2) ** 2;
      rgba.set(ring ? [255, 255, 255, 255] : [230, 40, 200, 255], (py * width + px) * 4);
    }
  }
  return { width, height, rgba };
}

/** The four turns of a picture side by side in two rows, as RGBA pixels. */
export function renderTurns(pic: Picture, tile: number): { width: number; height: number; rgba: Uint8ClampedArray } {
  const views = [0, 1, 2, 3].map((turn) => render(pic, { turn, tile }));
  const gap = 8;
  const cw = Math.max(...views.map((v) => v.width));
  const ch = Math.max(...views.map((v) => v.height));
  const width = cw * 2 + gap * 3;
  const height = ch * 2 + gap * 3;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([18, 18, 22, 255], i * 4);
  views.forEach((v, n) => {
    const ox = gap + (n % 2) * (cw + gap) + Math.floor((cw - v.width) / 2);
    const oy = gap + Math.floor(n / 2) * (ch + gap) + (ch - v.height);
    for (let y = 0; y < v.height; y++) rgba.set(v.rgba.subarray(y * v.width * 4, (y + 1) * v.width * 4), ((oy + y) * width + ox) * 4);
  });
  return { width, height, rgba };
}

/** The block list as the designer reads it, appended to its instructions: grouped by what each kind takes. */
export function blockListText(blocks: BlockList): string {
  const by = new Map<string, string[]>();
  for (const b of blocks.blocks) {
    const k = b.kind ?? "";
    by.set(k, [...(by.get(k) ?? []), b.id]);
  }
  const what: Record<string, string> = {
    "": "Full blocks (no properties)",
    stairs: "Stairs (facing, half; the stairs step sets facing itself)",
    slab: "Slabs (type)",
    axis: "Logs and pillars (axis)",
    wall: "Walls (they join up by themselves)",
    fence: "Fences (they join up by themselves)",
    pane: "Panes and bars (they join up by themselves)",
    lantern: "Lanterns (hanging)",
    wall_torch: "Torches on a wall (facing: the direction the torch points away from its wall)",
    leaves: "Leaves (they never decay)",
  };
  const lines = ["## Blocks you may use", ""];
  for (const [k, ids] of by) {
    const props = blocks.kinds[k]?.props;
    lines.push(`${what[k] ?? k}${props ? `: ${Object.entries(props).map(([p, v]) => `${p}=${v.join("|")}`).join(", ")}` : ""}`);
    lines.push(ids.join(", "), "");
  }
  return lines.join("\n").trimEnd() + "\n";
}
