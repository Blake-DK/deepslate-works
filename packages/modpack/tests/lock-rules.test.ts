import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintManifest } from "../src/lint";
import { hashResourcePack, type LockEntry } from "../src/lock";
import { widenForDependents } from "../src/sides";

// docs/31 PR E: B-26 (a client-only library must not stop the Lock), B-28 (what a switched-on mod requires is
// switched on), B-30 (README.md is not part of the texture pack's hash), B-25 and B-10 (the pins in mods.json).

const MODS = path.join(__dirname, "../../../modpack/mods.json");
const entry = (slug: string, side: LockEntry["side"], extra: Partial<LockEntry> = {}): LockEntry => ({
  slug, name: slug, projectId: "p-" + slug, versionId: "v", versionNumber: "1", versionType: "release", filename: `${slug}.jar`, url: "https://cdn/x.jar",
  sha512: "0", sha1: "0", size: 1, side, requiredBy: [], ...extra,
});

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("B-26: a client-only library of a mod that runs on both sides", () => {
  it("stays on PCs with a warning, where it used to stop the Lock (Rechiseled needs Fusion)", () => {
    const fusion = entry("fusion", "client", { requiredBy: ["rechiseled"], modrinth: { client: "required", server: "unsupported" } });
    const warnings: string[] = [];
    expect(() => widenForDependents([entry("rechiseled", "both"), fusion], (w) => warnings.push(w))).not.toThrow();
    expect(fusion.side).toBe("client");
    expect(warnings).toEqual(["fusion: rechiseled runs on the server too, but this library is client-only on Modrinth; it stays on PCs"]);
  });
  it("a library that can run on the server still goes there", () => {
    const lib = entry("lib", "client", { requiredBy: ["tacz"], modrinth: { client: "required", server: "optional" } });
    widenForDependents([entry("tacz", "both"), lib]);
    expect(lib.side).toBe("both");
  });
  it("the other way round is still an error: a mod on PCs cannot need a library that does not run there", () => {
    expect(() => widenForDependents([entry("tacz", "both"), entry("lib", "server", { requiredBy: ["tacz"], modrinth: { client: "unsupported", server: "required" } })])).toThrow(/does not run on the client/);
  });
});

describe("B-28: what a switched-on mod requires is switched on", () => {
  it("the real mods.json lints without that error, Vanillin requires Create, and rpl is on with Create Big Cannons", async () => {
    const raw = JSON.parse(await readFile(MODS, "utf8")) as { neoforge: string; mods: Array<{ slug: string; enabled: boolean; requires: string[]; version?: string }> };
    const { issues } = lintManifest(raw);
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    const by = new Map(raw.mods.map((m) => [m.slug, m]));
    expect(by.get("flw-vanillin")?.requires).toContain("create");
    expect(by.get("rpl")?.enabled).toBe(true);
  });
  it("switching Create off while Vanillin stays on is refused by lint, which stops CI and Apply results", async () => {
    const raw = JSON.parse(await readFile(MODS, "utf8")) as { mods: Array<{ slug: string; enabled: boolean }> };
    raw.mods.find((m) => m.slug === "create")!.enabled = false;
    const errors = lintManifest(raw).issues.filter((i) => i.level === "error").map((i) => i.message);
    expect(errors).toContain("flw-vanillin: is switched on and requires create, which is switched off");
  });
});

describe("B-25 and B-10: the pins", () => {
  it("NeoForge is a version, not 'latest', and it is the lock's", async () => {
    const raw = JSON.parse(await readFile(MODS, "utf8")) as { neoforge: string };
    expect(raw.neoforge).toMatch(/^21\.1\.\d+$/);
    const lock = JSON.parse(await readFile(path.join(path.dirname(MODS), "mods.lock.json"), "utf8")) as { neoforge: string };
    expect(lock.neoforge).toBe(raw.neoforge);
  });
});

describe("B-30: the texture pack's hash covers what Build ships", () => {
  it("editing README.md does not move it; editing a texture does", async () => {
    const d = await mkdtemp(path.join(tmpdir(), "rp-"));
    dirs.push(d);
    const v = path.join(d, "assets/minecraft/textures/entity/villager");
    await mkdir(v, { recursive: true });
    await writeFile(path.join(d, "pack.mcmeta"), '{"pack":{"pack_format":34,"description":"t"}}');
    await writeFile(path.join(d, "README.md"), "drop textures here");
    await writeFile(path.join(v, "villager.png"), "skin");
    const h = await hashResourcePack(d);
    await writeFile(path.join(d, "README.md"), "a different note");
    expect(await hashResourcePack(d)).toBe(h);
    await writeFile(path.join(v, "villager.png"), "another skin");
    expect(await hashResourcePack(d)).not.toBe(h);
  });
});
