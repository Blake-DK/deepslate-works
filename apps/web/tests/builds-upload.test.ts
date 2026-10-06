import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compound, int, short, writeNbt, type Tag } from "modpack/nbt";

// docs/37: an uploaded build is read on the site as it arrives. Its size and the mods its blocks come from are kept
// beside it; one with blocks of a mod the pack does not have (dist/pack-blocks.json) is turned away unless the admin
// ticked "the missing blocks become air".

let root = "";
let builds: typeof import("@/server/builds");

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "uploads-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("DIST_DIR", path.join(root, "dist"));
  await import("node:fs/promises").then((fs) => fs.mkdir(path.join(root, "dist"), { recursive: true }));
  await writeFile(path.join(root, "dist", "pack-blocks.json"), JSON.stringify({ builtAt: "2026-10-06T12:00:00Z", namespaces: { minecraft: "Minecraft", create: "Create" } }));
  builds = await import("@/server/builds");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

// a WorldEdit .schem, 3 by 1 by 1: stone, a Create cogwheel, a Copycats block
const schem = (palette: Record<string, number>, data: number[]): Buffer =>
  writeNbt(compound({ Version: int(2), Width: short(data.length), Height: short(1), Length: short(1), Palette: compound(Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, int(v)]))), BlockData: { t: 7, v: Buffer.from(data) } as Tag }));
const file = (name: string, body: Buffer) => new File([new Uint8Array(body)], name);
const MIXED = schem({ "minecraft:stone": 0, "create:cogwheel": 1, "copycats:copycat_block": 2 }, [0, 1, 2]);

describe("uploading a build", () => {
  it("turns away blocks of a mod the pack does not have, and names them; nothing is saved", async () => {
    const r = await builds.storeBuild("hut", file("hut.schem", MIXED));
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("mods the pack does not have: copycats (1 block: copycat_block)") as string });
    expect(await builds.listBuilds()).toEqual([]);
  });

  it("takes it with the tick, keeping its size and what it needs beside it", async () => {
    const r = await builds.storeBuild("hut", file("hut.schem", MIXED), { allowMissing: true });
    expect(r.ok && r.build.note).toMatchObject({ allowMissing: true, packKnown: true, check: { size: { x: 3, y: 1, z: 1 }, blocks: 3, missing: ["copycats"] } });
    const [listed] = await builds.listBuilds();
    expect(listed).toMatchObject({ name: "hut", format: "schem", note: { check: { needs: [{ namespace: "minecraft", blocks: 1 }, { namespace: "create", blocks: 1 }, { namespace: "copycats", blocks: 1 }] } } });
  });

  it("takes a build whose mods are all in the pack without asking, and a .litematic by its name", async () => {
    const r = await builds.storeBuild("mill", file("mill.schem", schem({ "minecraft:stone": 0, "create:cogwheel": 1 }, [0, 1])));
    expect(r.ok && r.build.note?.check.missing).toEqual([]);
    expect(builds.buildFormat("Castle.LITEMATIC")).toBe("litematic");
  });

  it("says a file does not read, before keeping it", async () => {
    const r = await builds.storeBuild("bad", file("bad.schem", writeNbt(compound({ Width: short(1), Height: short(1), Length: short(1) }))));
    expect(r).toEqual({ ok: false, reason: "The file does not read: not a WorldEdit .schem of version 2 or 3: it has no block palette." });
  });

  it("removes the file and what was kept beside it", async () => {
    expect(await builds.removeBuild("hut")).toBe(true);
    expect((await readdir(path.join(root, "data", "builds"))).sort()).toEqual(["mill.json", "mill.schem"]);
  });
});
