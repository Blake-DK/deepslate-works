import { mkdtemp, readdir, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/build";
import type { LockFile } from "../src/lock";
import type { Manifest } from "../src/schema";

const PACK = path.join(__dirname, "../../../modpack/datapacks/deepslate-limbo");
const json = async (f: string) => JSON.parse(await readFile(path.join(PACK, f), "utf8")) as Record<string, unknown>;

describe("the datapack deepslate-limbo (docs/14)", () => {
  it("is a datapack for 1.21.1", async () => {
    expect((await json("pack.mcmeta")).pack).toMatchObject({ pack_format: 48 });
  });
  it("has the dimension type the planner wrote down", async () => {
    expect(await json("data/deepslate/dimension_type/limbo.json")).toEqual({
      natural: false, ultrawarm: false, has_skylight: true, has_ceiling: false, fixed_time: 18000, effects: "minecraft:the_end",
      bed_works: false, respawn_anchor_works: false, has_raids: false, piglin_safe: false, monster_spawn_light_level: 0,
      monster_spawn_block_light_limit: 0, min_y: 0, height: 256, logical_height: 256, coordinate_scale: 1, ambient_light: 0.1,
      infiniburn: "#minecraft:infiniburn_overworld",
    });
  });
  it("has an empty, flat dimension of that type: the void and nothing in it", async () => {
    expect(await json("data/deepslate/dimension/limbo.json")).toEqual({ type: "deepslate:limbo", generator: { type: "minecraft:flat", settings: { layers: [], biome: "minecraft:the_void", features: false, lakes: false } } });
  });
});

describe("buildServer", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
  it("puts the datapacks next to the server files, for Sync to carry into the world", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "datapack-test-"));
    const packs = path.join(dir, "datapacks", "deepslate-limbo");
    await mkdir(packs, { recursive: true });
    await writeFile(path.join(packs, "pack.mcmeta"), "{}");
    const lines: string[] = [];
    const out = await buildServer({ version: "0.0.1" } as Manifest, { files: [], hash: "abcdef0123456789", neoforge: "21.1.252" } as unknown as LockFile, { dist: path.join(dir, "dist"), config: path.join(dir, "none"), server: path.join(dir, "none"), datapacks: path.join(dir, "datapacks") }, (l) => lines.push(l));
    expect(await readFile(path.join(out, "datapacks", "deepslate-limbo", "pack.mcmeta"), "utf8")).toBe("{}");
    expect(lines).toContain("datapacks: deepslate-limbo");
  });
  it("leaves no settings behind that are no longer in the pack", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "config-test-"));
    const config = path.join(dir, "config");
    const server = path.join(dir, "server");
    await mkdir(config, { recursive: true });
    await mkdir(path.join(server, "config", "bluemap"), { recursive: true });
    await writeFile(path.join(config, "fallingtree.json"), "{}");
    await writeFile(path.join(server, "config", "bluemap", "core.conf"), "x");
    const stale = path.join(dir, "dist", "server", "config", "tabtps");
    await mkdir(stale, { recursive: true });
    await writeFile(path.join(stale, "default.conf"), "old");
    const out = await buildServer({ version: "0.0.1" } as Manifest, { files: [], hash: "abcdef0123456789", neoforge: "21.1.252" } as unknown as LockFile, { dist: path.join(dir, "dist"), config, server }, () => {});
    expect((await readdir(path.join(out, "config"))).sort()).toEqual(["bluemap", "fallingtree.json"]);
  });
});

describe("the starter kit in deepslate-tools (docs/25)", () => {
  const TOOLS = path.join(__dirname, "../../../modpack/datapacks/deepslate-tools");
  const ROOT = path.join(__dirname, "../../..");
  const fn = (name: string) => readFile(path.join(TOOLS, "data/deepslate/function/kit", `${name}.mcfunction`), "utf8");
  // the commands of a function: no blank lines, no comments
  const commands = async (name: string) => (await fn(name)).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

  it("runs deepslate:kit/tick every tick, and has its three functions", async () => {
    const tick = JSON.parse(await readFile(path.join(TOOLS, "data/minecraft/tags/function/tick.json"), "utf8")) as { values: string[] };
    expect(tick.values).toContain("deepslate:kit/tick");
    for (const name of ["tick", "give", "backpack"]) expect((await commands(name)).length).toBeGreaterThan(0);
  });
  it("gives only vanilla items the 1.21.1 server knows", async () => {
    const known = (JSON.parse(await readFile(path.join(ROOT, "modpack/items/vanilla-1.21.1.json"), "utf8")) as { items: Record<string, number> }).items;
    const ids = (await commands("give")).flatMap((c) => [...c.matchAll(/\bminecraft:([a-z0-9_]+)/g)].map((m) => m[1]!));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect([id, id in known]).toEqual([id, true]);
  });
  it("marks the player last, and only gives to verified players without the mark", async () => {
    expect((await commands("give")).at(-1)).toBe("tag @s add deepslate.kit");
    const [tick, ...rest] = await commands("tick");
    expect(rest).toEqual([]);
    const selector = /@a\[([^\]]*)\]/.exec(tick!)?.[1]?.split(",").map((s) => s.trim()) ?? [];
    expect(selector).toEqual(expect.arrayContaining(["tag=verified", "tag=!deepslate.kit"]));
  });
  it("keeps the backpack in a file of its own, while Sophisticated Backpacks is in the pack", async () => {
    expect(await commands("backpack")).toEqual(["give @s sophisticatedbackpacks:backpack 1"]);
    const mods = (JSON.parse(await readFile(path.join(ROOT, "modpack/mods.json"), "utf8")) as { mods: Array<{ slug: string; enabled: boolean }> }).mods;
    // a vote that takes the mod out fails here, and somebody decides what the kit holds instead (docs/25 §5)
    expect(mods.find((m) => m.slug === "sophisticated-backpacks")?.enabled).toBe(true);
  });
});

describe("adventure mode in the spawn claim, in deepslate-tools (docs/27)", () => {
  const TOOLS = path.join(__dirname, "../../../modpack/datapacks/deepslate-tools");
  const commands = async (name: string) =>
    (await readFile(path.join(TOOLS, "data/deepslate/function/spawn", `${name}.mcfunction`), "utf8")).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  // the arguments of a command's first @a[...] selector
  const selector = (cmd: string) => /@a\[([^\]]*)\]/.exec(cmd)?.[1]?.split(",").map((s) => s.trim()) ?? [];

  it("runs deepslate:spawn/tick every tick beside the kit, and has enter and leave", async () => {
    const tick = JSON.parse(await readFile(path.join(TOOLS, "data/minecraft/tags/function/tick.json"), "utf8")) as { values: string[] };
    expect(tick.values).toEqual(expect.arrayContaining(["deepslate:kit/tick", "deepslate:spawn/tick"]));
    for (const name of ["tick", "enter", "leave"]) expect((await commands(name)).length).toBeGreaterThan(0);
  });
  it("marks the area once, in the overworld: the server claim for SPAWN_POS 107.5 126 87.5, grown by 5 blocks each way", async () => {
    const tick = await commands("tick");
    const marks = tick.filter((c) => /\bdx=/.test(c));
    expect(marks).toHaveLength(1); // the coordinates are written once
    expect(marks[0]).toMatch(/^execute in minecraft:overworld run tag @a\[/);
    const v = Object.fromEntries(selector(marks[0]!).map((kv) => kv.split("=") as [string, string]));
    const { spawnClaimArea, parsePos } = await import("../../../apps/api/src/actions/registry");
    const a = spawnClaimArea(parsePos("107.5 126 87.5"));
    // out of a survival player's reach (4.5 blocks) of every claimed block: 5 more on each side (planner, docs/27 follow-up)
    const grown = { x1: a.x1 - 5, z1: a.z1 - 5, x2: a.x2 + 5, z2: a.z2 + 5 };
    expect(grown).toEqual({ x1: 27, z1: 11, x2: 164, z2: 148 });
    // a volume selector covers x to x + dx, both ends in, as block coordinates
    expect({ x1: Number(v.x), z1: Number(v.z), x2: Number(v.x) + Number(v.dx), z2: Number(v.z) + Number(v.dz) }).toEqual(grown);
    expect(Number(v.y)).toBeLessThanOrEqual(-64); // every height
    expect(Number(v.y) + Number(v.dy)).toBeGreaterThanOrEqual(320);
  });
  it("puts only verified players in survival into adventure, and only gives survival back to verified players in adventure", async () => {
    const tick = await commands("tick");
    const enter = selector(tick.find((c) => c.includes("spawn/enter"))!);
    expect(enter).toEqual(expect.arrayContaining(["tag=verified", "gamemode=survival", "tag=deepslate.spawn_area"]));
    // creative then survival inside the area: enter runs again for a player who still carries deepslate.spawn
    expect(enter).not.toContain("tag=!deepslate.spawn");
    expect(await commands("enter")).toEqual(["gamemode adventure @s", "tag @s add deepslate.spawn"]);
    const leaving = selector(tick.find((c) => c.includes("spawn/leave"))!);
    expect(leaving).toEqual(expect.arrayContaining(["tag=deepslate.spawn", "tag=!deepslate.spawn_area"]));
    const leave = await commands("leave");
    expect(leave).toContain("tag @s remove deepslate.spawn");
    const back = leave.filter((c) => /gamemode/.test(c));
    expect(back).toEqual(["execute if entity @s[tag=verified,gamemode=adventure] run gamemode survival @s"]);
  });
  it("never selects creative or spectator, and changes a mode only as the player on themselves (silent)", async () => {
    for (const name of ["tick", "enter", "leave"]) {
      for (const c of await commands(name)) {
        expect(c).not.toMatch(/gamemode=(creative|spectator)|gamemode (creative|spectator)/);
        if (/(^|run )gamemode /.test(c)) expect(c).toMatch(/gamemode (adventure|survival) @s$/);
      }
    }
  });
});

describe("the createdeco:placard fix, in deepslate-tools", () => {
  // Create Deco 2.1.3 (latest for 1.21.1) ships this recipe with the dye as {"id": ...}, which 1.21.1 cannot read
  // ("Parsing error loading recipe createdeco:placard", on every start). The world's datapack replaces it.
  const RECIPE = path.join(__dirname, "../../../modpack/datapacks/deepslate-tools/data/createdeco/recipe/placard.json");
  type Recipe = { "neoforge:conditions": unknown; ingredients: Array<Record<string, string>>; result: unknown };
  const recipe = async () => JSON.parse(await readFile(RECIPE, "utf8")) as Recipe;

  it("names every ingredient by item or tag, the 1.21.1 way", async () => {
    const { ingredients } = await recipe();
    expect(ingredients).toEqual([{ tag: "createdeco:placards" }, { item: "minecraft:white_dye" }]);
    for (const i of ingredients) expect(Object.keys(i)).toEqual([expect.stringMatching(/^(item|tag)$/)]);
  });
  it("still makes a white Create placard, and only while Create Deco is in the pack", async () => {
    const r = await recipe();
    expect(r.result).toEqual({ count: 1, id: "create:placard" });
    expect(r["neoforge:conditions"]).toEqual([{ type: "neoforge:mod_loaded", modid: "createdeco" }]);
  });
});
