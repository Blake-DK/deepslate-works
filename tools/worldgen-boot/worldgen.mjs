#!/usr/bin/env node
// Step 0 of the worlds plan (docs/36): can a datapack dimension be given a "seed" of our own in 1.21.1?
// Run only by .github/workflows/worldgen-boot.yml, against a vanilla server that is thrown away afterwards.
//
//   worldgen.mjs packs <vanilla worldgen dir> <datapacks dir>   one datapack per test world
//   worldgen.mjs commands load|measure|read                         console commands, one per line
//   worldgen.mjs report <server.log>                            what was measured, as markdown; exit 1 if a world is missing
//
// Two ways to a seed are tried side by side:
//   shift   the vanilla noise settings, with a constant added to the shift of every shifted noise (the land's maps)
//   rename  the vanilla noise settings on noises with new names (docs/32 W2.1: a noise is seeded by its name)
// "plain" is the vanilla settings as they are: what a world is without either, to compare against.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const PACK_FORMAT = 48; // Minecraft 1.21.1

/** base: the vanilla noise settings the world is made from. */
const WORLDS = [
  { id: "t_plain", base: "overworld", mode: "plain" },
  { id: "t_shift_a", base: "overworld", mode: "shift", seed: "alpha" },
  { id: "t_shift_b", base: "overworld", mode: "shift", seed: "beta" },
  { id: "t_rename", base: "overworld", mode: "rename" },
  { id: "t_large_plain", base: "large_biomes", mode: "plain" }, // what a Frontier is today (docs/20 §5)
  { id: "t_large_shift", base: "large_biomes", mode: "shift", seed: "alpha" },
  { id: "t_nether_plain", base: "nether", mode: "plain" },
  { id: "t_nether_shift", base: "nether", mode: "shift", seed: "alpha" },
  { id: "t_nether_rename", base: "nether", mode: "rename" },
  { id: "t_end_plain", base: "end", mode: "plain" },
  { id: "t_end_shift", base: "end", mode: "shift", seed: "alpha" },
  { id: "t_end_rename", base: "end", mode: "rename" },
  { id: "t_caves_plain", base: "caves", mode: "plain" },
  { id: "t_caves_shift", base: "caves", mode: "shift", seed: "alpha" },
];

/** The dimension type and the biomes that go with each base. */
const SHAPE = {
  overworld: { type: "minecraft:overworld", biomes: { type: "minecraft:multi_noise", preset: "minecraft:overworld" } },
  large_biomes: { type: "minecraft:overworld", biomes: { type: "minecraft:multi_noise", preset: "minecraft:overworld" } },
  caves: { type: "minecraft:overworld_caves", biomes: { type: "minecraft:multi_noise", preset: "minecraft:overworld" } },
  nether: { type: "minecraft:the_nether", biomes: { type: "minecraft:multi_noise", preset: "minecraft:nether" } },
  end: { type: "minecraft:the_end", biomes: { type: "minecraft:the_end" } },
};

const POINTS = [[0, 0], [1000, 1000], [-2500, 700], [4000, -3000], [-800, -5200], [7000, 7000]];
const AIR_Y = [40, 70, 100];
const BIOME_Y = 64;
/** label → dimension. The game's own three are measured too: a plain copy should be their twin. */
const DIMS = [
  ["main", "minecraft:overworld"],
  ["nether", "minecraft:the_nether"],
  ["end", "minecraft:the_end"],
  ...WORLDS.map((w) => [w.id, `deepslate:${w.id}`]),
];

/** A whole number between 100,000 and 900,000 either way, from the seed and the noise's name. */
export function offset(seed, noise, axis) {
  const n = createHash("sha256").update(`${seed}|${noise}|${axis}`).digest().readUInt32BE(0);
  const v = (n % 1_600_001) - 800_000;
  return v < 0 ? v - 100_000 : v + 100_000;
}

function packOf(world, vanilla) {
  const files = new Map();
  const json = (p, v) => files.set(p, `${JSON.stringify(v, null, 2)}\n`);
  const shape = SHAPE[world.base];
  json("pack.mcmeta", { pack: { pack_format: PACK_FORMAT, description: `worldgen test: ${world.id} (${world.base}, ${world.mode})` } });
  let settings = `minecraft:${world.base}`;
  if (world.mode !== "plain") {
    const read = (kind, id) => JSON.parse(readFileSync(path.join(vanilla, kind, `${id}.json`), "utf8"));
    const isFunction = (s) => s.startsWith("minecraft:") && existsSync(path.join(vanilla, "density_function", `${s.slice(10)}.json`));
    const copied = new Map(); // a vanilla density function → our copy of it
    const noises = new Map(); // a vanilla noise → our copy of it
    const copyFunction = (id) => {
      const had = copied.get(id);
      if (had) return had;
      const mine = `deepslate:${world.id}/${id.slice(10)}`;
      copied.set(id, mine); // before its body: a function may be reached twice
      json(`data/deepslate/worldgen/density_function/${world.id}/${id.slice(10)}.json`, rewrite(read("density_function", id.slice(10)), ""));
      return mine;
    };
    const copyNoise = (id) => {
      const had = noises.get(id);
      if (had) return had;
      const mine = `deepslate:${world.id}/${id.slice(10)}`;
      noises.set(id, mine);
      json(`data/deepslate/worldgen/noise/${world.id}/${id.slice(10)}.json`, read("noise", id.slice(10)));
      return mine;
    };
    function rewrite(node, key) {
      if (typeof node === "string") {
        if (key === "type") return node;
        if (key === "noise") return world.mode === "rename" && node.startsWith("minecraft:") ? copyNoise(node) : node;
        return isFunction(node) ? copyFunction(node) : node;
      }
      if (Array.isArray(node)) return node.map((n) => rewrite(n, key));
      if (node === null || typeof node !== "object") return node;
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = rewrite(v, k);
      if (world.mode === "shift" && node.type === "minecraft:shifted_noise" && typeof node.noise === "string") {
        out.shift_x = { type: "minecraft:add", argument1: offset(world.seed, node.noise, "x"), argument2: out.shift_x };
        out.shift_z = { type: "minecraft:add", argument1: offset(world.seed, node.noise, "z"), argument2: out.shift_z };
      }
      return out;
    }
    const base = read("noise_settings", world.base);
    json(`data/deepslate/worldgen/noise_settings/${world.id}.json`, { ...base, noise_router: rewrite(base.noise_router, "") });
    settings = `deepslate:${world.id}`;
  }
  json(`data/deepslate/dimension/${world.id}.json`, { type: shape.type, generator: { type: "minecraft:noise", settings, biome_source: shape.biomes } });
  return files;
}

function packs(vanilla, out) {
  for (const world of WORLDS) {
    const root = path.join(out, `deepslate-test-${world.id}`);
    rmSync(root, { recursive: true, force: true });
    const files = packOf(world, vanilla);
    for (const [rel, body] of files) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), body);
    }
    console.log(`${world.id}: ${files.size} files (${world.base}, ${world.mode})`);
  }
}

function commands(step, vanilla) {
  const lines = [];
  // every biome the game has, from its own files: the game has no "which biome is this", only "is it this one"
  const biomes = step === "measure" ? readdirSync(path.join(vanilla, "biome")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort() : [];
  for (const [label, dim] of DIMS) {
    POINTS.forEach(([x, z], i) => {
      if (step === "load") lines.push(`execute in ${dim} run forceload add ${x} ${z}`);
      else if (step === "measure") {
        // the height of the ground (water does not count), carried out of the game in a marker's own name
        lines.push(`execute in ${dim} positioned ${x} 0 ${z} positioned over ocean_floor run summon minecraft:marker ~ ~ ~ {Tags:["probe"],CustomName:'"P-${label}-${i}"'}`);
        for (const y of AIR_Y) lines.push(`execute in ${dim} if block ${x} ${y} ${z} #minecraft:air run say A-${label}-${i}-${y}`);
        for (const b of biomes) lines.push(`execute in ${dim} if biome ${x} ${BIOME_Y} ${z} minecraft:${b} run say B-${label}-${i}-${b}`);
      }
    });
  }
  // a marker is not there for a selector in the tick it was summoned in, so reading them is a step of its own
  if (step === "load") lines.push("say STEP-LOADED");
  if (step === "measure") lines.push("say STEP-SUMMONED");
  if (step === "read") {
    lines.push("execute as @e[type=minecraft:marker,tag=probe] run data get entity @s Pos[1]");
    lines.push("say PROBES-DONE");
  }
  console.log(lines.join("\n"));
}

function report(logFile) {
  const log = readFileSync(logFile, "utf8");
  const heights = new Map(); // label → height per point
  const air = new Set();
  for (const m of log.matchAll(/P-([a-z_]+)-(\d+) has the following entity data: (-?[\d.]+)d/g)) {
    const row = heights.get(m[1]) ?? [];
    row[Number(m[2])] = Math.round(Number(m[3]));
    heights.set(m[1], row);
  }
  for (const m of log.matchAll(/\[Server\] (A-[a-z_]+-\d+-\d+)/g)) air.add(m[1]);
  const biomeAt = new Map(); // label-point → biome
  for (const m of log.matchAll(/\[Server\] B-([a-z_]+-\d+)-([a-z_]+)/g)) biomeAt.set(m[1], m[2]);
  const signature = (label) => {
    const h = heights.get(label);
    if (!h || h.filter((v) => v !== undefined).length !== POINTS.length) return null;
    const bits = POINTS.map((_, i) => AIR_Y.map((y) => (air.has(`A-${label}-${i}-${y}`) ? "1" : "0")).join("")).join(" ");
    const biomes = POINTS.map((_, i) => biomeAt.get(`${label}-${i}`) ?? "?");
    return { h, bits, biomes };
  };
  const out = ["## Worldgen boot", "", `Heights of the ground at ${POINTS.map((p) => `(${p.join(", ")})`).join(" ")}; air at y ${AIR_Y.join(", ")} per point; the biome at y ${BIOME_Y}.`, "", "| World | Heights | Air | Biomes |", "|---|---|---|---|"];
  const missing = [];
  for (const [label] of DIMS) {
    const s = signature(label);
    if (!s) missing.push(label);
    out.push(`| ${label} | ${s ? s.h.join(", ") : "**no data**"} | ${s ? s.bits : ""} | ${s ? s.biomes.join(", ") : ""} |`);
  }
  const differs = (a, b) => {
    const x = signature(a);
    const y = signature(b);
    if (!x || !y) return "no data | no data";
    const n = x.h.filter((v, i) => v !== y.h[i]).length;
    const same = n === 0 && x.bits === y.bits;
    const moved = x.biomes.filter((v, i) => v !== y.biomes[i]).length;
    return `${same ? "**the same**" : `differs (${n} of ${POINTS.length} heights${x.bits === y.bits ? "" : ", air too"})`} | ${moved === 0 ? "**the same**" : `differ at ${moved} of ${POINTS.length}`}`;
  };
  out.push("", "| Question | Ground | Biomes |", "|---|---|---|");
  for (const [q, a, b] of [
    ["A plain copy is the main world's twin", "t_plain", "main"],
    ["Shift: seed alpha against the main world", "t_shift_a", "main"],
    ["Shift: seed alpha against seed beta", "t_shift_a", "t_shift_b"],
    ["Rename against the main world", "t_rename", "main"],
    ["Large biomes as it is (today's Frontier) against the main world", "t_large_plain", "main"],
    ["Large biomes shifted against large biomes as it is", "t_large_shift", "t_large_plain"],
    ["A plain Nether copy against the Nether", "t_nether_plain", "nether"],
    ["Nether shifted against the Nether", "t_nether_shift", "nether"],
    ["Nether renamed against the Nether", "t_nether_rename", "nether"],
    ["A plain End copy against the End", "t_end_plain", "end"],
    ["End shifted against the End", "t_end_shift", "end"],
    ["End renamed against the End", "t_end_rename", "end"],
    ["Caves shifted against caves as it is", "t_caves_shift", "t_caves_plain"],
  ]) out.push(`| ${q} | ${differs(a, b)} |`);
  if (!log.includes("PROBES-DONE")) out.push("", "**The server did not get to the end of the probes.**");
  if (missing.length) out.push("", `**No data for: ${missing.join(", ")}.** The dimension did not load, or its chunks were not made in time.`);
  console.log(out.join("\n"));
  if (missing.length || !log.includes("PROBES-DONE")) process.exit(1);
}

const [what, a, b] = process.argv.slice(2);
if (what === "packs" && a && b) packs(a, b);
else if (what === "commands" && ["load", "measure", "read"].includes(a) && (a !== "measure" || b)) commands(a, b);
else if (what === "report" && a) report(a);
else {
  console.error("usage: worldgen.mjs packs <vanilla worldgen dir> <datapacks dir> | commands load|read | commands measure <vanilla worldgen dir> | report <server.log>");
  process.exit(2);
}
