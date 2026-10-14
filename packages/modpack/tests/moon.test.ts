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
    const kinds: Record<string, string> = { "worldgen/noise": "noise", "worldgen/density_function": "density_function", "worldgen/biome": "biome", "worldgen/noise_settings": "noise_settings", dimension_type: "dimension_type", recipe: "recipe" };
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

/** One `set_damage` with `add` as 1.21.1 does it, all in floats: remaining fraction + damage, clamped, then floor((1 - that) * max). */
function setDamage(d: number, max: number, damage: number): number {
  const f = Math.fround;
  const left = f(1 - f(d / max));
  const g = f(1 - Math.min(1, Math.max(0, f(left + f(damage)))));
  return Math.floor(f(g * max));
}

describe("the radiation below y 30 (docs/55 M7; Alex, 2026-10-14: radiation, not gas, stronger the deeper you go, and it kills below y -25)", () => {
  const fn = (f: string) => text(`data/deepslate/function/gas/${f}.mcfunction`);
  const lines = async (f: string) => (await fn(f)).split("\n").filter((l) => l && !l.startsWith("#"));
  it("runs once a second, never every tick: started from #minecraft:load, it schedules itself again", async () => {
    expect(await json("data/minecraft/tags/function/load.json")).toEqual({ values: ["deepslate:gas/load"] });
    expect(await lines("load")).toEqual(["scoreboard objectives add deepslate.gas dummy", "scoreboard objectives add deepslate.band dummy", "schedule function deepslate:gas/second 20t replace"]);
    expect((await lines("second")).at(-1)).toBe("schedule function deepslate:gas/second 20t replace");
    expect(JSON.stringify(await json("data/minecraft/tags/function/tick.json"))).not.toContain("gas");
  });
  it("reaches players not in creative or spectator, on the Moon, with their feet below y 30 (Alex, 2026-10-14; the planner had y 0)", async () => {
    expect(await lines("second")).toContain("execute as @a[gamemode=!creative,gamemode=!spectator] at @s if dimension deepslate:moon if entity @s[y=-64,dy=94] run function deepslate:gas/check");
  });
  it("three depths: band 1 below y 30, 2 below y 0, 3 below y -25 (the same reading of dy as the line above)", async () => {
    expect((await lines("check")).slice(0, 3)).toEqual([
      "scoreboard players set @s deepslate.band 1",
      "execute if entity @s[y=-64,dy=64] run scoreboard players set @s deepslate.band 2",
      "execute if entity @s[y=-64,dy=39] run scoreboard players set @s deepslate.band 3",
    ]);
  });
  it("exposure climbs 1, 2 or 3 a second with depth (1 with a mask below y -25), falls 2 a second otherwise, never below 0", async () => {
    expect((await lines("breathe")).slice(0, 4)).toEqual([
      "scoreboard players add @s deepslate.gas 1",
      "execute unless entity @s[tag=deepslate.masked] if score @s deepslate.band matches 2.. run scoreboard players add @s deepslate.gas 1",
      "execute unless entity @s[tag=deepslate.masked] if score @s deepslate.band matches 3 run scoreboard players add @s deepslate.gas 1",
      "execute if score @s deepslate.gas matches 41.. run scoreboard players set @s deepslate.gas 40",
    ]);
    expect(await lines("recover")).toEqual(["scoreboard players remove @s deepslate.gas 2", "execute if score @s deepslate.gas matches ..-1 run scoreboard players set @s deepslate.gas 0"]);
    expect(await lines("second")).toContain("execute as @a[tag=!deepslate.in_gas,scores={deepslate.gas=1..}] run function deepslate:gas/recover");
  });
  it("three stages: a warning to 10, Poison I and Slowness I to 30, then Poison II, Slowness II and Mining Fatigue I", async () => {
    const b = (await lines("breathe")).join("\n");
    expect(b).toContain("matches ..10 run title @s actionbar");
    for (const e of ["poison 2 0", "slowness 2 0"]) expect(b).toContain(`matches 11..30 run effect give @s minecraft:${e} true`);
    for (const e of ["poison 2 1", "slowness 2 1", "mining_fatigue 2 0"]) expect(b).toContain(`matches 31.. run effect give @s minecraft:${e} true`);
  });
  it("kills only below y -25: from 11 on, Mekanism's radiation damage, a heart a second; nothing else in it does damage", async () => {
    const b = await lines("breathe");
    const hurts = b.filter((l) => /wither|instant_damage|damage @s|kill/.test(l));
    expect(hurts).toEqual(["execute if score @s deepslate.band matches 3 if score @s deepslate.gas matches 11.. run damage @s 2 mekanism:radiation"]);
    expect(b.filter((l) => l.includes("actionbar") && l.includes("band matches 3"))).toHaveLength(1);
  });
});

describe("the masks and the hazmat suit (docs/55 M8; Alex, 2026-10-14)", () => {
  const basic = 'minecraft:leather_helmet[minecraft:custom_data~{deepslate_mask:"basic"}]';
  it("below y -25 a whole suit protects (all four slots, hazmat or MekaSuit); otherwise a mask protects above y -25 and only slows it below", async () => {
    const check = (await text("data/deepslate/function/gas/check.mcfunction")).split("\n").filter((l) => l && !l.startsWith("#"));
    expect(check.slice(3)).toEqual([
      "execute if score @s deepslate.band matches 3 if items entity @s armor.head #deepslate:radiation_suit/head if items entity @s armor.chest #deepslate:radiation_suit/chest if items entity @s armor.legs #deepslate:radiation_suit/legs if items entity @s armor.feet #deepslate:radiation_suit/feet run return run function deepslate:gas/suit",
      "tag @s remove deepslate.masked",
      `execute if items entity @s armor.head ${basic} run tag @s add deepslate.masked`,
      "execute if items entity @s armor.head #deepslate:gas_mask_hazmat run tag @s add deepslate.masked",
      "execute if items entity @s armor.head #deepslate:gas_mask_sealed run tag @s add deepslate.masked",
      `execute if items entity @s armor.head ${basic} run function deepslate:gas/mask/basic`,
      'execute if items entity @s armor.head #deepslate:gas_mask_hazmat run function deepslate:gas/hazmat/wear {slot:"armor.head"}',
      "execute if score @s deepslate.band matches ..2 if entity @s[tag=deepslate.masked] run return 1",
      "function deepslate:gas/breathe",
    ]);
    const suit = (await text("data/deepslate/function/gas/suit.mcfunction")).split("\n").filter((l) => l && !l.startsWith("#"));
    expect(suit).toEqual(["head", "chest", "legs", "feet"].map((s) => `execute if items entity @s armor.${s} #deepslate:hazmat_suit run function deepslate:gas/hazmat/wear {slot:"armor.${s}"}`));
  });
  it("Mekanism's items are named by tags with optional entries (ids from the 10.7.19.85 jar), so the functions load without Mekanism", async () => {
    const opt = (...ids: string[]) => ({ values: ids.map((id) => ({ id, required: false })) });
    expect(await json("data/deepslate/tags/item/gas_mask_hazmat.json")).toEqual(opt("mekanism:hazmat_mask"));
    expect(await json("data/deepslate/tags/item/gas_mask_sealed.json")).toEqual(opt("mekanism:mekasuit_helmet"));
    expect(await json("data/deepslate/tags/item/hazmat_suit.json")).toEqual(opt("mekanism:hazmat_mask", "mekanism:hazmat_gown", "mekanism:hazmat_pants", "mekanism:hazmat_boots"));
    expect(await json("data/deepslate/tags/item/radiation_suit/head.json")).toEqual({ values: ["#deepslate:gas_mask_hazmat", "#deepslate:gas_mask_sealed"] });
    expect(await json("data/deepslate/tags/item/radiation_suit/chest.json")).toEqual(opt("mekanism:hazmat_gown", "mekanism:mekasuit_bodyarmor"));
    expect(await json("data/deepslate/tags/item/radiation_suit/legs.json")).toEqual(opt("mekanism:hazmat_pants", "mekanism:mekasuit_pants"));
    expect(await json("data/deepslate/tags/item/radiation_suit/feet.json")).toEqual(opt("mekanism:hazmat_boots", "mekanism:mekasuit_boots"));
  });
  it("our gas mask: a cheap shapeless recipe for a dark leather helmet with 30 points, its own icon, and no anvil", async () => {
    const r = await json("data/deepslate/recipe/gas_mask.json");
    expect(r.type).toBe("minecraft:crafting_shapeless");
    expect((r.ingredients as Array<{ item: string }>).map((i) => i.item).sort()).toEqual(["minecraft:charcoal", "minecraft:glass_pane", "minecraft:leather", "minecraft:string", "minecraft:string"]);
    const result = r.result as { id: string; components: Record<string, unknown> };
    expect(result.id).toBe("minecraft:leather_helmet");
    expect(result.components).toMatchObject({ "minecraft:custom_data": { deepslate_mask: "basic" }, "minecraft:max_damage": 30 });
    expect(JSON.parse(result.components["minecraft:custom_name"] as string).text).toBe("Gas mask");
    expect(result.components["minecraft:repair_cost"]).toBeGreaterThanOrEqual(40); // an anvil refuses 40 and up
    expect((await json("data/deepslate/advancement/recipes/gas_mask.json")).rewards).toEqual({ recipes: ["deepslate:gas_mask"] });
  });
  it("our gas mask wears one point a second below y 30 (30 s), two below y 0, four below y -25, and is taken off with a sound and a message at its last point", async () => {
    const m = await json("data/deepslate/item_modifier/gas/wear_basic.json");
    expect(m).toMatchObject({ function: "minecraft:set_damage", add: true });
    for (let d = 0; d < 30; d++) expect(setDamage(d, 30, m.damage as number)).toBe(d + 1);
    const basic = (await text("data/deepslate/function/gas/mask/basic.mcfunction")).split("\n").filter((l) => l && !l.startsWith("#"));
    const wear = "item modify entity @s armor.head deepslate:gas/wear_basic";
    expect(basic.slice(0, 4)).toEqual([wear, `execute if score @s deepslate.band matches 2.. run ${wear}`, `execute if score @s deepslate.band matches 3 run ${wear}`, `execute if score @s deepslate.band matches 3 run ${wear}`]);
    expect(basic[4]).toContain("[minecraft:damage~{durability:{max:0}}] run function deepslate:gas/mask/broke");
    const broke = await text("data/deepslate/function/gas/mask/broke.mcfunction");
    for (const l of ["item replace entity @s armor.head with minecraft:air", "playsound minecraft:entity.item.break", "Your mask has given out.", "scoreboard players set @s deepslate.gas 0"]) expect(broke).toContain(l);
  });
  it("hazmat gear gets 1800 points the first time it is worn in the radiation (Mekanism gives it none), then wears one a second (30 min), two below y 0, four below y -25", async () => {
    expect(await json("data/deepslate/item_modifier/gas/hazmat_durability.json")).toEqual({ function: "minecraft:set_components", components: { "minecraft:max_damage": 1800, "minecraft:damage": 0 } });
    const m = await json("data/deepslate/item_modifier/gas/wear_hazmat.json");
    expect(m).toMatchObject({ function: "minecraft:set_damage", add: true });
    for (let d = 0; d < 1800; d++) expect(setDamage(d, 1800, m.damage as number)).toBe(d + 1);
    const wear = (await text("data/deepslate/function/gas/hazmat/wear.mcfunction")).split("\n").filter((l) => l && !l.startsWith("#"));
    const one = "item modify entity @s $(slot) deepslate:gas/wear_hazmat";
    expect(wear).toEqual([
      "$execute if items entity @s $(slot) #deepslate:hazmat_suit[!minecraft:max_damage] run item modify entity @s $(slot) deepslate:gas/hazmat_durability",
      `$${one}`,
      `$execute if score @s deepslate.band matches 2.. run ${one}`,
      `$execute if score @s deepslate.band matches 3 run ${one}`,
      `$execute if score @s deepslate.band matches 3 run ${one}`,
      '$execute if items entity @s $(slot) #deepslate:hazmat_suit[minecraft:damage~{durability:{max:0}}] run function deepslate:gas/hazmat/broke {slot:"$(slot)"}',
    ]);
    const broke = await text("data/deepslate/function/gas/hazmat/broke.mcfunction");
    for (const l of ["$item replace entity @s $(slot) with minecraft:air", "playsound minecraft:entity.item.break", "worn out"]) expect(broke).toContain(l);
    await expect(text("data/deepslate/function/gas/mask/hazmat.mcfunction")).rejects.toThrow();
  });
});

describe("the gas mask's icon, in the resource pack (docs/55 M8)", () => {
  const RP = path.join(MODPACK, "resourcepack");
  it("keeps vanilla's ten armour-trim models on the leather helmet and adds ours last, on the recipe's custom_model_data", async () => {
    const model = JSON.parse(await readFile(path.join(RP, "assets/minecraft/models/item/leather_helmet.json"), "utf8")) as { overrides: Array<{ predicate: Record<string, number>; model: string }>; textures: Record<string, string> };
    expect(model.textures).toEqual({ layer0: "minecraft:item/leather_helmet", layer1: "minecraft:item/leather_helmet_overlay" });
    const trims = ["quartz", "iron", "netherite", "redstone", "copper", "gold", "emerald", "diamond", "lapis", "amethyst"];
    expect(model.overrides.slice(0, 10)).toEqual(trims.map((t, i) => ({ model: `minecraft:item/leather_helmet_${t}_trim`, predicate: { trim_type: Number(((i + 1) / 10).toFixed(1)) } })));
    const cmd = ((await json("data/deepslate/recipe/gas_mask.json")).result as { components: Record<string, unknown> }).components["minecraft:custom_model_data"];
    expect(model.overrides.at(-1)).toEqual({ predicate: { custom_model_data: cmd }, model: "deepslate:item/gas_mask" });
  });
  it("its model and both 16×16 textures are there", async () => {
    const m = JSON.parse(await readFile(path.join(RP, "assets/deepslate/models/item/gas_mask.json"), "utf8")) as { textures: Record<string, string> };
    for (const t of Object.values(m.textures)) {
      const png = await readFile(path.join(RP, `assets/deepslate/textures/${t.split(":")[1]}.png`));
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([16, 16]);
    }
  });
});

describe("the Moon's map (docs/55 M5)", () => {
  it("is shipped as config/bluemap/maps/moon.conf: id moon, the dimension deepslate:moon in the world folder", async () => {
    const conf = await readFile(path.join(MODPACK, "server/config/bluemap/maps/moon.conf"), "utf8");
    const keys = Object.fromEntries(conf.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => [l.split(":")[0]!.trim(), l.slice(l.indexOf(":") + 1).trim()]));
    expect(keys).toMatchObject({ world: '"world"', dimension: '"deepslate:moon"', name: '"Ashmoon"', storage: '"file"' });
    // BlueMap 5.7's own template (maps/map.conf in its jar) has every one of these keys
    for (const k of Object.keys(keys)) expect(["world", "dimension", "name", "sorting", "sky-color", "void-color", "sky-light", "ambient-light", "remove-caves-below-y", "cave-detection-ocean-floor", "storage"]).toContain(k);
  });
});

describe("the horror trial on Ashmoon only (Alex, 2026-10-14): modpack/datapacks/deepslate-moon-mobs", () => {
  const MOBS = path.join(MODPACK, "datapacks/deepslate-moon-mobs");
  const mjson = async (f: string) => JSON.parse(await readFile(path.join(MOBS, f), "utf8")) as Record<string, unknown>;
  const CRAWLING = ["arphex:crawling_canopy", "arphex:cryptic_complex", "arphex:decadent_desert", "arphex:tormented_tunnels", "arphex:webbed_wasteland"];
  it("Mutant Monsters: every main-world, Nether and End biome is in its four 'without' tags; Ashmoon's are not", async () => {
    for (const mob of ["creeper", "enderman", "skeleton", "zombie"]) {
      const t = await mjson(`data/mutantmonsters/tags/worldgen/biome/without_mutant_${mob}_spawns.json`);
      const values = t.values as string[];
      expect(t.replace).toBe(false);
      expect(values).toEqual(expect.arrayContaining(["minecraft:plains", "minecraft:deep_dark", "#minecraft:is_nether", "#minecraft:is_end"]));
      expect(values.filter((v) => v.startsWith("deepslate:") || v === "#minecraft:is_overworld" || v === "#c:is_overworld")).toEqual([]);
      expect(values.filter((v) => v.startsWith("minecraft:"))).toHaveLength(53);
    }
  });
  it("ArPhEx: each spawn rule for the main world now points at Ashmoon's three biomes (keeping any of its own biomes), counted only where ArPhEx is installed; the one for its own dimension alone is ArPhEx's own again", async () => {
    const dir = path.join(MOBS, "data/arphex/neoforge/biome_modifier");
    const files = await readdir(dir);
    expect(files.length).toBe(59);
    // the Crawling's own rule (weight 1000) is shipped as ArPhEx wrote it: Sync never deletes, so the copy #71 pointed at
    // Ashmoon has to be overwritten on a server that has it, not left behind
    const own = await mjson("data/arphex/neoforge/biome_modifier/crawling_random_biome_modifier.json");
    expect((own.biomes as string[]).every((b) => b.startsWith("arphex:"))).toBe(true);
    for (const f of files.filter((x) => x !== "crawling_random_biome_modifier.json")) {
      const j = await mjson(`data/arphex/neoforge/biome_modifier/${f}`);
      const biomes = j.biomes as string[];
      expect(j.type).toBe("neoforge:add_spawns");
      expect(biomes.slice(0, 3)).toEqual(BIOMES);
      expect(biomes.slice(3).filter((b) => !b.startsWith("arphex:"))).toEqual([]);
      expect(j["neoforge:conditions"]).toEqual([{ type: "neoforge:mod_loaded", modid: "arphex" }]);
      expect(j.spawners).toBeTruthy();
    }
    // what spawned in every biome there is: Ashmoon's and ArPhEx's own dimension, its five biomes written out (ArPhEx 5.0.2's
    // tag arphex:crawling_biomes) because a biome list cannot also hold a tag
    for (const f of ["any_dimension_spawner_biome_modifier.json", "tormentor_initial_biome_modifier.json"]) expect((await mjson(`data/arphex/neoforge/biome_modifier/${f}`)).biomes).toEqual([...BIOMES, ...CRAWLING]);
  });
  it("kept (Alex, 2026-10-14): in every pack, live's too, and listed for everyone", async () => {
    const m = JSON.parse(await readFile(path.join(MODPACK, "mods.json"), "utf8")) as { mods: Array<{ slug: string; season?: string; adminOnly?: boolean }> };
    for (const slug of ["arphex", "mutant-monsters", "puzzles-lib", "nyfs-spiders", "geckolib"]) expect(m.mods.find((x) => x.slug === slug)?.season).toBeUndefined();
    for (const slug of ["arphex", "mutant-monsters", "nyfs-spiders"]) expect(m.mods.find((x) => x.slug === slug)?.adminOnly).toBe(false);
  });
});

describe("the horror trial kept on Ashmoon: ArPhEx's structures and its test-only settings", () => {
  const MOBS = path.join(MODPACK, "datapacks/deepslate-moon-mobs");
  it("its five structures that would go into the main world generate on Ashmoon's biomes instead, only where ArPhEx is installed", async () => {
    const dir = path.join(MOBS, "data/arphex/worldgen/structure");
    const files = (await readdir(dir)).sort();
    expect(files).toEqual(["altar_spawn.json", "ant_hill.json", "crawling_castle.json", "spider_cave.json", "termite_hill.json"]);
    for (const f of files) {
      const j = JSON.parse(await readFile(path.join(dir, f), "utf8")) as Record<string, unknown>;
      expect(j.biomes).toEqual(BIOMES);
      expect(j["neoforge:conditions"]).toEqual([{ type: "neoforge:mod_loaded", modid: "arphex" }]);
    }
  });
  it("on every server: no vanilla mob anywhere is replaced by an ArPhEx one, and no scare in the main world's sky", async () => {
    const toml = await readFile(path.join(MODPACK, "server/config/ArPhEx Configurations.toml"), "utf8");
    expect(toml).toContain('"Vanilla Replacement Mode" = 0.0');
    expect(toml).toContain('"Enable Tormentor Sky Hallucination" = false');
    expect(toml).toContain('"Welcome message" = false'); // Alex, 2026-10-14: no wall of text in chat at every join
  });
  it("more mobs on Ashmoon (Alex, 2026-10-14): ArPhEx's two spawn rates at 2 (5 by default, lower = more), mutants at 25 % of the creeper's weight, Ashmoon's own night monsters in groups of 4 to 6", async () => {
    const toml = await readFile(path.join(MODPACK, "server/config/ArPhEx Configurations.toml"), "utf8");
    expect(toml).toContain('"Non-boss global spawnrates (biome-specific)" = 2.0');
    expect(toml).toContain('"Random-system spawnrates (not biome-specific)" = 2.0');
    const mutants = await readFile(path.join(MODPACK, "server/config/mutantmonsters-common.toml"), "utf8");
    expect(mutants.match(/_spawn_weight = 0\.25$/gm)).toHaveLength(4);
    for (const id of BIOMES) {
      const spawners = (await json(`data/deepslate/worldgen/biome/${id.split(":")[1]}.json`)).spawners as { monster: Array<{ type: string; minCount: number; maxCount: number }> };
      for (const m of spawners.monster.filter((x) => x.type !== "minecraft:enderman")) expect([m.minCount, m.maxCount]).toEqual([4, 6]);
    }
  });
});

describe("every datapack we ship loads (2026-10-14: the test server refused to start)", () => {
  // A list of biomes (or of anything else from a registry) outside a tag file is either ids or one "#tag" string,
  // never both: ["deepslate:moon_plains", "#arphex:crawling_biomes"] stops the server with "Not a JSON object".
  // Only tag files (data/*/tags/...) may mix ids and "#tags" in their values.
  function lists(v: unknown, at: string, out: Array<{ at: string; list: unknown[] }>) {
    if (Array.isArray(v)) {
      out.push({ at, list: v });
      v.forEach((x, i) => lists(x, `${at}[${i}]`, out));
    } else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) lists(x, `${at}.${k}`, out);
    return out;
  }
  it("no list outside a tag file holds a '#tag'", async () => {
    const bad: string[] = [];
    for (const e of await readdir(path.join(MODPACK, "datapacks"), { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const pack = e.name;
      const dir = path.join(MODPACK, "datapacks", pack);
      for (const f of (await filesUnder(dir)).filter((x) => x.endsWith(".json") && !/^data\/[^/]+\/tags\//.test(x))) {
        for (const { at, list } of lists(JSON.parse(await readFile(path.join(dir, f), "utf8")), "", [])) {
          // a tag reference, not a crafting pattern row such as "###"
          if (list.some((x) => typeof x === "string" && /^#[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(x))) bad.push(`${pack}/${f}${at}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
