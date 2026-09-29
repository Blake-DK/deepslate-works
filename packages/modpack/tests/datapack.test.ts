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
