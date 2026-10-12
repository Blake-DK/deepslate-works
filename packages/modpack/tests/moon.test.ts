import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// docs/55 M1 to M4: the Moon's datapack, and Mekanism's retrogen switched off.

const MODPACK = path.join(__dirname, "../../../modpack");
const PACK = path.join(MODPACK, "datapacks/deepslate-moon");
const text = (f: string) => readFile(path.join(PACK, f), "utf8");
const json = async (f: string) => JSON.parse(await text(f)) as Record<string, unknown>;
const BIOMES = ["deepslate:moon_plains", "deepslate:moon_highlands", "deepslate:moon_craters"];

async function filesUnder(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await filesUnder(dir, r)));
    else out.push(r);
  }
  return out;
}
/** Every string anywhere in a JSON value. */
function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

describe("the Moon's dimension (docs/55 M2)", () => {
  it("is a datapack for 1.21.1", async () => {
    expect((await json("pack.mcmeta")).pack).toMatchObject({ pack_format: 48 });
  });
  it("has the overworld's height, a fixed night under the overworld's sky, hostile mobs, and no beds or anchors", async () => {
    expect(await json("data/deepslate/dimension_type/moon.json")).toMatchObject({
      min_y: -64, height: 384, logical_height: 384, natural: true, fixed_time: 18000, effects: "minecraft:overworld",
      has_skylight: true, has_ceiling: false, bed_works: false, respawn_anchor_works: false, coordinate_scale: 1,
    });
  });
  it("runs on noise settings of its own, over its three biomes and no others", async () => {
    const dim = await json("data/deepslate/dimension/moon.json");
    expect(dim.type).toBe("deepslate:moon");
    const gen = dim.generator as { type: string; settings: string; biome_source: { type: string; biomes: Array<{ biome: string }> } };
    expect(gen.type).toBe("minecraft:noise");
    expect(gen.settings).toBe("deepslate:moon");
    expect(gen.biome_source.biomes.map((b) => b.biome).sort()).toEqual([...BIOMES].sort());
  });
  it("names nothing of its own namespace that the pack does not have", async () => {
    const files = new Set(await filesUnder(PACK));
    const kinds: Record<string, string> = { "worldgen/noise": "noise", "worldgen/density_function": "density_function", "worldgen/biome": "biome", "worldgen/noise_settings": "noise_settings", dimension_type: "dimension_type" };
    const has = (id: string) => Object.keys(kinds).some((k) => files.has(`data/deepslate/${k}/${id}.json`));
    const named = new Set<string>();
    for (const f of [...files].filter((x) => x.startsWith("data/deepslate/") && x.endsWith(".json") && !x.includes("/tags/")))
      for (const s of strings(JSON.parse(await text(f)))) if (/^deepslate:[a-z0-9_/]+$/.test(s)) named.add(s.slice("deepslate:".length));
    expect([...named].filter((id) => !has(id))).toEqual([]);
    expect(named.has("moon/base")).toBe(true);
  });
  it("has no water: air as its fluid, no aquifers, sea level at the bottom; deepslate under y 0", async () => {
    const s = await json("data/deepslate/worldgen/noise_settings/moon.json");
    expect(s).toMatchObject({ default_fluid: { Name: "minecraft:air" }, aquifers_enabled: false, sea_level: -64, default_block: { Name: "minecraft:stone" } });
    expect(JSON.stringify(s.surface_rule)).toContain('"Name":"minecraft:deepslate"');
  });
});

describe("the Moon's biomes (docs/55 M2)", () => {
  const ORES = ["coal", "iron", "copper", "gold", "redstone", "lapis", "diamond", "emerald"];
  for (const id of BIOMES) {
    const file = `data/deepslate/worldgen/biome/${id.split(":")[1]}.json`;
    it(`${id}: every vanilla ore, the stone patches and geodes; no lakes, plants or springs; no rain`, async () => {
      const b = await json(file);
      expect(b.has_precipitation).toBe(false);
      const features = (b.features as string[][]).flat();
      for (const ore of ORES) expect(features.some((f) => f.startsWith(`minecraft:ore_${ore}`))).toBe(true);
      for (const stone of ["granite", "diorite", "andesite", "tuff"]) expect(features.some((f) => f.startsWith(`minecraft:ore_${stone}`))).toBe(true);
      expect(features).toContain("minecraft:amethyst_geode");
      expect(features.filter((f) => /lake|spring|patch|tree|flower|grass|lichen|kelp|seagrass|disk|monster_room|magma/.test(f))).toEqual([]);
    });
    it(`${id}: the night monsters only, no animals`, async () => {
      const spawners = (await json(file)).spawners as Record<string, Array<{ type: string }>>;
      expect(spawners.monster!.map((s) => s.type).sort()).toEqual(["minecraft:creeper", "minecraft:enderman", "minecraft:skeleton", "minecraft:spider", "minecraft:zombie"]);
      for (const [group, list] of Object.entries(spawners)) if (group !== "monster") expect(list).toEqual([]);
    });
  }
  it("all three carry the same features and mobs, so their order can never disagree", async () => {
    const [a, ...rest] = await Promise.all(BIOMES.map((id) => json(`data/deepslate/worldgen/biome/${id.split(":")[1]}.json`)));
    for (const b of rest) {
      expect(b.features).toEqual(a!.features);
      expect(b.spawners).toEqual(a!.spawners);
    }
  });
});

describe("the tags (docs/55 M2)", () => {
  it("the three biomes are overworld biomes to other mods, added to both tags, never replacing them", async () => {
    for (const f of ["data/minecraft/tags/worldgen/biome/is_overworld.json", "data/c/tags/worldgen/biome/is_overworld.json"]) expect(await json(f)).toEqual({ replace: false, values: BIOMES });
  });
  it("Mekanism's ores go to the Moon alone: its tag is replaced, not added to", async () => {
    expect(await json("data/mekanism/tags/worldgen/biome/spawn_ores.json")).toEqual({ replace: true, values: BIOMES });
  });
});

describe("the portal (docs/55 M4)", () => {
  it("a smooth basalt frame lit with an eye of ender, the tags Server Sided Portals reads for deepslate:moon", async () => {
    expect(await json("data/deepslate/tags/block/moon_portal_frame.json")).toEqual({ values: ["minecraft:smooth_basalt"] });
    expect(await json("data/deepslate/tags/item/moon_portal_igniter.json")).toEqual({ values: ["minecraft:ender_eye"] });
  });
  it("is neither the Nether's frame, nor the Frontier's, nor lit by fire", async () => {
    const frame = (await json("data/deepslate/tags/block/moon_portal_frame.json")).values as string[];
    const igniter = (await json("data/deepslate/tags/item/moon_portal_igniter.json")).values as string[];
    for (const f of frame) expect(["minecraft:obsidian", "minecraft:crying_obsidian", "minecraft:reinforced_deepslate"]).not.toContain(f);
    for (const i of igniter) expect(["minecraft:flint_and_steel", "minecraft:fire_charge"]).not.toContain(i);
  });
});

describe("low gravity (docs/55 M3)", () => {
  it("runs every tick from #minecraft:tick", async () => {
    expect(await json("data/minecraft/tags/function/tick.json")).toEqual({ values: ["deepslate:moon/tick"] });
  });
  it("is for players only: in the Moon they get both modifiers, anywhere else they lose both", async () => {
    const tick = (await text("data/deepslate/function/moon/tick.mcfunction")).split("\n").filter((l) => l && !l.startsWith("#"));
    expect(tick).toEqual([
      "execute as @a[tag=!deepslate.moon] at @s if dimension deepslate:moon run function deepslate:moon/arrive",
      "execute as @a[tag=deepslate.moon] at @s unless dimension deepslate:moon run function deepslate:moon/leave",
    ]);
    const arrive = await text("data/deepslate/function/moon/arrive.mcfunction");
    const leave = await text("data/deepslate/function/moon/leave.mcfunction");
    for (const [attr, id] of [["generic.gravity", "deepslate:moon_gravity"], ["generic.safe_fall_distance", "deepslate:moon_safe_fall"]]) {
      expect(arrive).toMatch(new RegExp(`^attribute @s minecraft:${attr} modifier add ${id} `, "m"));
      expect(leave).toContain(`attribute @s minecraft:${attr} modifier remove ${id}`);
    }
    expect(arrive).toContain("tag @s add deepslate.moon");
    expect(leave).toContain("tag @s remove deepslate.moon");
  });
  it("gravity is about a sixth of normal, and a fall counts from further", async () => {
    const arrive = await text("data/deepslate/function/moon/arrive.mcfunction");
    const g = Number(/generic\.gravity modifier add deepslate:moon_gravity (-?[\d.]+) add_multiplied_base/.exec(arrive)?.[1]);
    expect(0.08 * (1 + g)).toBeCloseTo(0.08 / 6, 3);
    expect(Number(/safe_fall_distance modifier add deepslate:moon_safe_fall ([\d.]+) add_value/.exec(arrive)?.[1])).toBeGreaterThan(0);
  });
});

describe("no retrogen (docs/55 M1)", () => {
  it("the server gets Mekanism's defaults back: regeneration off, world version 0", async () => {
    const toml = (await readFile(path.join(MODPACK, "server/config/Mekanism/world.toml"), "utf8")).split("\n").filter((l) => l && !l.startsWith("#"));
    expect(toml).toEqual(["enableRegeneration = false", "userWorldGenVersion = 0"]);
  });
});
