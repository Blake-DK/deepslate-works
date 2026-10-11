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
  it("live ships nothing yet: 71 files, 0.1.0+d44eb2ba, the pack every PC has; the test server with SEASONS_SHIP=s1 gets all 77", async () => {
    const live = await readShippedLock(REPO, {});
    expect(live.files).toHaveLength(71);
    expect(live.hash.slice(0, 8)).toBe("d44eb2ba");
    expect(live.files.some((f) => f.season)).toBe(false);
    const test = await readShippedLock(REPO, { TEST_MODE: "1", SEASONS_SHIP: "s1" });
    expect(test.files).toHaveLength(77);
    expect(await readShippedLock(REPO, { SEASONS_SHIP: "s1" })).toEqual(live); // ignored without TEST_MODE
    expect(await sitePack(REPO)).toMatch(/\+d44eb2ba$/);
  });
  it("SEASONS_SHIP is read as the modpack package reads it", () => {
    expect(shipFor(["s1"], {})).toEqual(["s1"]);
    expect(shipFor([], { TEST_MODE: "1", SEASONS_SHIP: "s1, sample s1" })).toEqual(["s1", "sample"]);
    expect(shipFor([], { TEST_MODE: "1", SEASONS_SHIP: "  " })).toEqual([]);
  });
});
