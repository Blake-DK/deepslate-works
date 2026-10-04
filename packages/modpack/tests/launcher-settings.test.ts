import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintManifest } from "../src/lint";
import { manifestSchema, serverViewDistance } from "../src/schema";

// docs/30 (app 3.5.0, the launcher's Settings tab): the most memory a player may choose, and the server's view distance
// the tab compares the render distance with.
const raw = async () => JSON.parse(await readFile(path.join(__dirname, "../../../modpack/mods.json"), "utf8"));

describe("ram.user_max_gb", () => {
  it("is 12 in mods.json, at least max_gb", async () => {
    const { manifest, issues } = lintManifest(await raw());
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(manifest!.ram).toEqual({ min_gb: 3, max_gb: 6, user_max_gb: 12 });
  });
  it("is optional: a mods.json without it is still valid (the app reads it as 8)", async () => {
    const m = await raw();
    delete m.ram.user_max_gb;
    const r = manifestSchema.safeParse(m);
    expect(r.success).toBe(true);
    expect(r.data!.ram.user_max_gb).toBeUndefined();
  });
  it("is never below max_gb", async () => {
    const m = await raw();
    m.ram.user_max_gb = 4;
    expect(manifestSchema.safeParse(m).success).toBe(false);
    m.ram.user_max_gb = 6;
    expect(manifestSchema.safeParse(m).success).toBe(true);
  });
});

describe("server_view_distance", () => {
  it("is the view-distance mods.json expects, 12 today", async () => {
    const { manifest } = lintManifest(await raw());
    expect(serverViewDistance(manifest!.server_properties)).toBe(12);
  });
  it("is null when mods.json does not give a usable one", () => {
    expect(serverViewDistance({})).toBeNull();
    expect(serverViewDistance(undefined)).toBeNull();
    expect(serverViewDistance({ "view-distance": "far" })).toBeNull();
    expect(serverViewDistance({ "view-distance": "64" })).toBeNull();
    expect(serverViewDistance({ "view-distance": "10" })).toBe(10);
  });
});
