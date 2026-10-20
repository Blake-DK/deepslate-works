import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packHash, seasonDependencies, shippedFiles, shippedLock, type LockEntry, type LockFile } from "../src/lock";
import { pendingSteps, type PendingFacts } from "../src/pending";
import { loadSeasons, readShip } from "../src/seasons";
import type { Manifest } from "../src/schema";

// docs/44: one mods.json and one lock for both servers; a season's mods go to a server only while it ships that season.

const MODPACK = path.join(__dirname, "../../../modpack");
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

const entry = (slug: string, season?: string, requiredBy: string[] = []) => ({ slug, name: slug, versionId: `v-${slug}`, requiredBy, ...(season ? { season } : {}) }) as unknown as LockEntry;
const lockOf = (files: LockEntry[]): LockFile => {
  const l = { generatedAt: "x", minecraft: "1.21.1", neoforge: "21.1.253", files, configs: [{ path: "config/a.toml", sha256: "1" }] } as unknown as LockFile;
  return { ...l, hash: packHash(l.neoforge, files, l.configs) };
};
const realLock = async () => JSON.parse(await readFile(path.join(MODPACK, "mods.lock.json"), "utf8")) as LockFile;

describe("what a server ships", () => {
  const lock = lockOf([entry("create"), entry("cataclysm", "s1"), entry("aquamirae", "s2")]);
  it("nothing of a season it does not ship; everything of one it does; an unknown season changes nothing", () => {
    expect(shippedFiles(lock, []).map((f) => f.slug)).toEqual(["create"]);
    expect(shippedFiles(lock, ["s1"]).map((f) => f.slug)).toEqual(["create", "cataclysm"]);
    expect(shippedFiles(lock, ["s1", "s2"]).map((f) => f.slug)).toEqual(["create", "cataclysm", "aquamirae"]);
    expect(shippedFiles(lock, ["s9"]).map((f) => f.slug)).toEqual(["create"]);
  });
  it("the pack's hash is over what ships, so each server has its own version; the same ship always gives the same hash", () => {
    const none = shippedLock(lock, []);
    const s1 = shippedLock(lock, ["s1"]);
    expect(none.hash).not.toBe(s1.hash);
    expect(none.hash).toBe(shippedLock(lock, []).hash);
    expect(none.hash).toBe(packHash(lock.neoforge, [entry("create")], lock.configs));
    expect(shippedLock(lock, ["s1", "s2"])).toBe(lock); // nothing left out: the lock itself
  });
});

describe("a season's libraries", () => {
  it("a library only a season's mods need belongs to that season", () => {
    const files = [entry("cataclysm", "s1"), entry("lionfish", undefined, ["cataclysm"]), entry("deeper", undefined, ["lionfish"])];
    seasonDependencies(files);
    expect(files.map((f) => f.season)).toEqual(["s1", "s1", "s1"]);
  });
  it("one that something outside the season needs too stays in every pack", () => {
    const files = [entry("cataclysm", "s1"), entry("create"), entry("geckolib", undefined, ["cataclysm", "create"])];
    seasonDependencies(files);
    expect(files[2]!.season).toBeUndefined();
  });
  it("a season's mod that something outside the season needs is refused at Lock", () => {
    expect(() => seasonDependencies([entry("geckolib", "s1", ["create"]), entry("create")])).toThrow(/geckolib is a Season s1 mod, but create needs it outside that season/);
  });
});

describe("the repo's pack (docs/44, 'Done when')", () => {
  it("Season 1's five mods carry season s1 in mods.json and in the lock, and nothing else does (GeckoLib left it with ArPhEx, Alex 2026-10-14)", async () => {
    const m = JSON.parse(await readFile(path.join(MODPACK, "mods.json"), "utf8")) as Manifest;
    const six = ["curios", "edf-remastered", "l_enders-cataclysm", "lionfish-api", "mowzies-mobs"];
    expect(m.mods.filter((x) => x.season).map((x) => [x.slug, x.season, x.enabled]).sort()).toEqual(six.map((s) => [s, "s1", true]));
    expect((await realLock()).files.filter((f) => f.season).map((f) => [f.slug, f.season]).sort()).toEqual(six.map((s) => [s, "s1"]));
  });
  it("every season a mod names has a season file", async () => {
    const m = JSON.parse(await readFile(path.join(MODPACK, "mods.json"), "utf8")) as Manifest;
    const { seasons } = await loadSeasons(path.join(MODPACK, "seasons"));
    for (const x of m.mods.filter((y) => y.season)) expect(seasons.map((s) => s.id)).toContain(x.season);
  });
  it("live, shipping nothing, keeps the pack it has (0.1.0+befdb793, 100 files since Create: Connected and Create Aeronautics with Sable, 2026-10-20; 97 before, since the animal and cosy mods: ten mods, two libraries and Moonlight, the duplicates dropped; 84 before, since the horror mobs on Ashmoon (ArPhEx, Mutant Monsters, Nyf's Spiders, with GeckoLib and Puzzles Lib) since Vanishmod, server only; Macaw's Holidays; the flower mods, docs/59; the gas mask's icon in the resource pack, docs/55 M8); a server shipping s1 gets all 105 (with the horror trial on Ashmoon)", async () => {
    const lock = await realLock();
    expect(lock.hash).toBe(packHash(lock.neoforge, lock.files, lock.configs, lock.resourcepack)); // the lock's own hash is over everything
    const live = shippedLock(lock, []);
    expect(live.files).toHaveLength(100);
    expect(live.hash.slice(0, 8)).toBe("befdb793");
    const test = shippedLock(lock, ["s1"]);
    expect(test.files).toHaveLength(105);
    expect(test.hash).toBe(lock.hash);
  });
  it("index.json ships nothing before Season 1 opens, so no reader hands its mods out on live", async () => {
    expect(await readShip(path.join(MODPACK, "seasons"), {})).toEqual([]);
  });
});

describe("whose ship list", () => {
  const seasonsDir = async (ship: string[]) => {
    const d = await mkdtemp(path.join(tmpdir(), "ship-"));
    dirs.push(d);
    await mkdir(d, { recursive: true });
    await writeFile(path.join(d, "index.json"), JSON.stringify({ current: "s1", ship }));
    return d;
  };
  it("index.json's, except on the test server, where SEASONS_SHIP replaces it; no index ships nothing", async () => {
    const d = await seasonsDir([]);
    expect(await readShip(d, {})).toEqual([]);
    expect(await readShip(d, { SEASONS_SHIP: "s1" })).toEqual([]); // ignored on live
    expect(await readShip(d, { TEST_MODE: "1", SEASONS_SHIP: "s1, sample" })).toEqual(["s1", "sample"]);
    expect(await readShip(await seasonsDir(["s1"]), { TEST_MODE: "1" })).toEqual(["s1"]);
    expect(await readShip(path.join(d, "nowhere"), {})).toEqual([]);
  });
});

describe("Admin → Modpack's out-of-date box", () => {
  it("holds the last Build to the pack this server ships, and Lock to the whole lock", () => {
    const lock = lockOf([entry("create"), entry("cataclysm", "s1")]);
    const shipped = `0.1.0+${shippedLock(lock, []).hash.slice(0, 8)}`;
    // one moment for both: two `new Date()` a millisecond apart read as "built again after the last sync"
    const now = new Date();
    const facts = (ship: string[], builtPack: string): PendingFacts => ({
      manifest: { version: "0.1.0", neoforge: "21.1.253", mods: [{ slug: "create", name: "create", enabled: true, version: "latest" }, { slug: "cataclysm", name: "cataclysm", enabled: true, version: "latest", season: "s1" }] } as unknown as Manifest,
      lock, ship, configs: lock.configs, resourcepack: undefined, builtPack, changedSinceBuild: [], settingsChanged: false,
      ciApp: null, builtApp: null, repoScript: null, builtScript: null, brandingPicked: false, synced: { version: builtPack, at: now }, serverBuiltAt: now,
    });
    expect(pendingSteps(facts([], shipped)).steps).toEqual([]);
    expect(pendingSteps(facts(["s1"], shipped)).steps).toEqual(["build", "sync"]); // the test server now ships s1: build again
  });
});
