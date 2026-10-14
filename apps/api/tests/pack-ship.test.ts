import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { packHash, readShippedLock, shipFor, type ShippedLock } from "../src/modpack/ship.js";
import { sitePack } from "../src/status/health-watch.js";

// docs/44: api's copy of the rule (packages/modpack lock.ts `shippedLock`, seasons.ts `shipFor`), held to the same
// answers on the repo's own lock: the lock's hash is the one `modpack lock` wrote, and live keeps its pack.

const REPO = path.join(__dirname, "../../..");

describe("the pack a server ships, as api reads it", () => {
  it("hashes as `modpack lock` does: over the whole lock it is the lock's own hash", async () => {
    const lock = JSON.parse(await readFile(path.join(REPO, "modpack", "mods.lock.json"), "utf8")) as ShippedLock;
    expect(packHash(lock, lock.files)).toBe(lock.hash);
  });
  it("live ships nothing yet: 77 files, 0.1.0+55ab70d7 (Mekanism and the quarry pause mod in, docs/53 and docs/56; the two flower mods, docs/59; the gas mask's icon, docs/55 M8); the test server with SEASONS_SHIP=s1 gets all 83", async () => {
    const live = await readShippedLock(REPO, {});
    expect(live.files).toHaveLength(77);
    expect(live.hash.slice(0, 8)).toBe("55ab70d7");
    expect(live.files.some((f) => f.season)).toBe(false);
    const test = await readShippedLock(REPO, { TEST_MODE: "1", SEASONS_SHIP: "s1" });
    expect(test.files).toHaveLength(83);
    expect(await readShippedLock(REPO, { SEASONS_SHIP: "s1" })).toEqual(live); // ignored without TEST_MODE
    expect(await sitePack(REPO)).toMatch(/\+55ab70d7$/);
  });
  it("SEASONS_SHIP is read as the modpack package reads it", () => {
    expect(shipFor(["s1"], {})).toEqual(["s1"]);
    expect(shipFor([], { TEST_MODE: "1", SEASONS_SHIP: "s1, sample s1" })).toEqual(["s1", "sample"]);
    expect(shipFor([], { TEST_MODE: "1", SEASONS_SHIP: "  " })).toEqual([]);
  });
});
