import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import archiver from "archiver";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPackDependencies, compareVersions, inRange, jarMods, parseRange, readModsToml, type JarMods } from "../src/deps";
import { buildLock, type LockEntry } from "../src/lock";
import type { Manifest, Mod } from "../src/schema";
import { openZip } from "../src/zip";

// The mods' own word on what they need of each other (META-INF/neoforge.mods.toml), checked at Lock. Both cases
// below passed Lock, lint and CI, and then every PC refused to start.

function zip(files: Record<string, string | Buffer>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const a = archiver("zip", { store: true });
    const out = new PassThrough();
    const parts: Buffer[] = [];
    out.on("data", (c: Buffer) => parts.push(c));
    out.on("end", () => resolve(Buffer.concat(parts)));
    a.on("error", reject);
    a.pipe(out);
    for (const [name, body] of Object.entries(files)) a.append(typeof body === "string" ? Buffer.from(body) : body, { name });
    void a.finalize();
  });
}

type Dep = [modId: string, type: string, range: string, side?: string];
/** A neoforge.mods.toml in the shape the real ones have (comments, quoted table keys, a multi-line description). */
const toml = (mods: Array<{ id: string; version: string; deps?: Dep[] }>) =>
  [
    `modLoader = "javafml" #mandatory`,
    `loaderVersion = "[4,)" #mandatory`,
    ...mods.flatMap((m) => [
      `[[mods]] #mandatory`,
      `modId = "${m.id}" #mandatory`,
      `version = "${m.version}" #mandatory`,
      `description = '''A mod. # not a comment\nTwo lines.''' #mandatory (Supports multiline text)`,
      ...(m.deps ?? []).flatMap(([modId, type, range, side]) => [`[[dependencies."${m.id}"]] #optional`, `modId = "${modId}"`, `type="${type}" #mandatory`, `versionRange = "${range}"`, `ordering = "NONE"`, ...(side ? [`side = "${side}"`] : [])]),
    ]),
  ].join("\n");

type Nest = { group: string; artifact: string; range: string; version: string; path: string; jar: Buffer };
async function jar(mods: Array<{ id: string; version: string; deps?: Dep[] }>, nested: Nest[] = []): Promise<Buffer> {
  const files: Record<string, string | Buffer> = { "META-INF/neoforge.mods.toml": toml(mods), "a/B.class": "Êþº¾" };
  if (nested.length) {
    files["META-INF/jarjar/metadata.json"] = JSON.stringify({ jars: nested.map((n) => ({ identifier: { group: n.group, artifact: n.artifact }, version: { range: n.range, artifactVersion: n.version }, path: n.path, isObfuscated: false })) });
    for (const n of nested) files[n.path] = n.jar;
  }
  return zip(files);
}

const entry = (slug: string, side: LockEntry["side"], extra: Partial<LockEntry> = {}): LockEntry => ({
  slug, name: slug, projectId: "p-" + slug, versionId: "v", versionNumber: "1", versionType: "release", filename: `${slug}.jar`, url: "https://cdn.modrinth.com/x.jar",
  sha512: "0", sha1: "0", size: 1, side, requiredBy: [], ...extra,
});
async function pack(files: Array<[LockEntry, Buffer]>) {
  const jars = new Map<string, JarMods | null>(files.map(([e, b]) => [e.filename, jarMods(openZip(b))]));
  return checkPackDependencies({ files: files.map(([e]) => e), minecraft: "1.21.1", neoforge: "21.1.253" }, jars);
}
const errors = (found: Array<{ level: string; message: string }>) => found.filter((p) => p.level === "error").map((p) => p.message);

describe("compareVersions: Maven's order, which NeoForge uses", () => {
  // from Maven's own ComparableVersionTest, each list in ascending order
  it.each([
    [["1-alpha2snapshot", "1-alpha2", "1-alpha-123", "1-beta-2", "1-beta123", "1-m2", "1-m11", "1-rc", "1-cr2", "1-rc123", "1-SNAPSHOT", "1", "1-sp", "1-sp2", "1-sp123", "1-abc", "1-def", "1-pom-1", "1-1-snapshot", "1-1", "1-2", "1-123"]],
    [["2.0", "2-1", "2.0.a", "2.0.0.a", "2.0.2", "2.0.123", "2.1.0", "2.1-a", "2.1b", "2.1-c", "2.1-1", "2.1.0.1", "2.2", "2.123", "11.a2", "11.a11", "11.b2", "11.b11", "11.m2", "11.m11", "11", "11.a", "11b", "11c", "11m"]],
  ])("%j", (list) => {
    for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) expect(Math.sign(compareVersions(list[i]!, list[j]!)), `${list[i]} vs ${list[j]}`).toBe(Math.sign(i - j));
    }
  });
  it("trailing zeros, release words and case do not count", () => {
    for (const [a, b] of [["1", "1.0"], ["1", "1.0.0"], ["1.0-ga", "1"], ["1-final", "1"], ["1.0-cr1", "1.0-rc1"], ["1.0-RC1", "1.0-rc1"], ["1.0-a1", "1.0-alpha1"]]) expect(compareVersions(a!, b!), `${a} = ${b}`).toBe(0);
  });
  it("the versions in the pack", () => {
    expect(compareVersions("1.0.6", "1.0.4")).toBeGreaterThan(0);
    expect(compareVersions("0.31.6", "0.32.4")).toBeLessThan(0);
    expect(compareVersions("21.1.253", "21.0.110-beta")).toBeGreaterThan(0);
    expect(compareVersions("0.8.13+mc1.21.1", "0.8.12-alpha.2+mc1.21.1")).toBeGreaterThan(0);
  });
});

describe("parseRange and inRange", () => {
  const ok = (spec: string, v: string) => inRange(parseRange(spec), v);
  it("bounds, open and closed", () => {
    expect(ok("[1.0.6,)", "1.0.6")).toBe(true);
    expect(ok("[1.0.6,)", "1.0.10")).toBe(true);
    expect(ok("[1.0.6,)", "1.0.4")).toBe(false);
    expect(ok("[1.0.6,2.0)", "2.0")).toBe(false);
    expect(ok("[1.0.6,2.0)", "1.9.9")).toBe(true);
    expect(ok("[21.0.110-beta, 21.2.0)", "21.1.253")).toBe(true); // spaces, as Xaero's maps write it
    expect(ok("(,0.8.12-alpha.2+mc1.21.1)", "0.8.13+mc1.21.1")).toBe(false);
    expect(ok("(1.6.0,)", "1.6.0")).toBe(false);
  });
  it("one version in [ ], and several sets", () => {
    expect(ok("[1.21.1]", "1.21.1")).toBe(true);
    expect(ok("[1.21.1]", "1.21.1.0")).toBe(true);
    expect(ok("[1.21.1]", "1.21.2")).toBe(false);
    expect(ok("[1,2),[3,4)", "3.5")).toBe(true);
    expect(ok("[1,2),[3,4)", "2.5")).toBe(false);
  });
  it("any version: empty, *, or a bare version (Maven takes it as a wish, not a bound)", () => {
    for (const spec of ["", "*", "1.21.1"]) expect(ok(spec, "0.1"), spec).toBe(true);
  });
  it("refuses what NeoForge would refuse", () => {
    for (const spec of ["[1.0", "(1.0)", "[2,1)", "[1,1)", "[3,4),[1,2)"]) expect(() => parseRange(spec), spec).toThrow();
  });
});

describe("readModsToml", () => {
  it("mods and their dependencies, as the real files write them", () => {
    const mods = readModsToml(toml([{ id: "simulated", version: "1.3.2", deps: [["flywheel", "required", "[1.0.6,)", "CLIENT"], ["jei", "optional", "[19.21.0.247,)"]] }]));
    expect(mods).toEqual([{ modId: "simulated", version: "1.3.2", deps: [{ modId: "flywheel", type: "required", range: "[1.0.6,)", side: "CLIENT" }, { modId: "jei", type: "optional", range: "[19.21.0.247,)", side: "BOTH" }] }]);
  });
  it("older files' mandatory, a version filled in from the jar's manifest, and blocks for a mod the file does not declare", () => {
    const text = [
      `[[mods]]`, `modId='old'`, `version="\${file.jarVersion}"`,
      `[[dependencies.old]]`, `modId="a"`, `mandatory=false`, `versionRange="[1,)"`, `side="client"`,
      `[[dependencies.old]]`, `modId="b"`, `mandatory=true`,
      `[[dependencies.xaerobetterpvp]]`, `modId="xaerolib"`, `type="required"`,
      `[modproperties.old]`, `catalogueItemIcon = { item = "minecraft:stone", count = [1, 2] }`,
    ].join("\r\n");
    expect(readModsToml(text, "2.4.1")).toEqual([{ modId: "old", version: "2.4.1", deps: [{ modId: "a", type: "optional", range: "[1,)", side: "CLIENT" }, { modId: "b", type: "required", range: "", side: "BOTH" }] }]);
    expect(readModsToml(text)[0]!.version).toBeNull();
  });
  it("a file it cannot read is an error, not a guess", () => {
    expect(() => readModsToml(`[[mods]]\nmodId = "x\nversion = "1"`)).toThrow(/never ends on line 2/);
  });
});

describe("jarMods", () => {
  it("reads jar-in-jar libraries through metadata.json, nested ones too", async () => {
    const inner = await jar([{ id: "deep", version: "0.1" }]);
    const lib = await jar([{ id: "lib", version: "2.0" }], [{ group: "g", artifact: "deep", range: "[0.1,)", version: "0.1", path: "META-INF/jarjar/deep.jar", jar: inner }]);
    const top = jarMods(openZip(await jar([{ id: "top", version: "1" }], [{ group: "g", artifact: "lib", range: "[2.0,)", version: "2.0", path: "META-INF/jars/lib.jar", jar: lib }])));
    expect(top.mods.map((m) => m.modId)).toEqual(["top"]);
    expect(top.nested.map((n) => [n.id, n.version, n.jar.mods[0]?.modId, n.jar.nested[0]?.jar.mods[0]?.modId])).toEqual([["g:lib", "2.0", "lib", "deep"]]);
    expect(top.notes).toEqual([]);
  });
  it("says what it could not read", async () => {
    const bad = jarMods(openZip(await zip({ "META-INF/neoforge.mods.toml": "[[mods]\n", "META-INF/jarjar/metadata.json": JSON.stringify({ jars: [{ identifier: { group: "g", artifact: "gone" }, version: { range: "[1,)", artifactVersion: "1" }, path: "META-INF/jarjar/gone.jar" }] }) })));
    expect(bad.notes).toEqual([expect.stringMatching(/neoforge\.mods\.toml could not be read/), "its jar-in-jar META-INF/jarjar/gone.jar is listed but not in the jar"]);
  });
});

// 2026-10-05 (docs/11 "Xaero's maps pinned back"): Xaero's Minimap 26.6.0 and World Map 1.47.0 came out that morning,
// both on "latest", and both only work with Open Parties and Claims 0.32.4 or newer; the pack pinned it at 0.31.6.
// Their real neoforge.mods.toml lists Open Parties and Claims as optional, with that range.
const xaero = async (minimap: string, worldmap: string, opacFrom: string) => {
  const xaerolib = await jar([{ id: "xaerolib", version: "1.7.3" }]);
  const lib = { group: "xaero.lib", artifact: "xaerolib-neoforge-1.21.1", range: "[1.7.3,)", version: "1.7.3", path: "META-INF/jarjar/xaerolib-neoforge-1.21.1-1.7.3.jar", jar: xaerolib };
  return [
    [entry("xaeros-minimap", "client"), await jar([{ id: "xaerominimap", version: minimap, deps: [["neoforge", "required", "[21.0.110-beta,21.2.0)", "BOTH"], ["minecraft", "required", "1.21.1", "BOTH"], ["openpartiesandclaims", "optional", opacFrom, "BOTH"], ["xaeroworldmap", "optional", "[1.44.0,)", "BOTH"]] }], [lib])],
    [entry("xaeros-world-map", "client"), await jar([{ id: "xaeroworldmap", version: worldmap, deps: [["neoforge", "required", "[21.0.110-beta, 21.2.0)", "BOTH"], ["minecraft", "required", "[1.21, 1.21.2)", "BOTH"], ["openpartiesandclaims", "optional", opacFrom, "BOTH"], ["xaerominimap", "optional", "[26.4.0,)", "BOTH"], ["xaerolib", "required", "[1.0,)", "BOTH"]] }], [lib])],
    [entry("open-parties-and-claims", "both"), await jar([{ id: "openpartiesandclaims", version: "0.31.6", deps: [["neoforge", "required", "[21.1.1,)", "BOTH"]] }])],
  ] as Array<[LockEntry, Buffer]>;
};

// 2026-10-20: Create 6.0.10 carries Flywheel 1.0.6 as dev.engine-room.flywheel:flywheel-neoforge-1.21.1, Vanillin
// 1.1.3 carries Flywheel 1.0.4 as dev.engine-room.flywheel:neoforge: two identifiers, so both are candidates, and PCs
// loaded 1.0.4. Create Aeronautics' nested Simulated requires flywheel [1.0.6,) on the client, Sable takes it optionally.
const flywheelCase = async (withVanillin = true, withAeronautics = true) => {
  const flywheel = (v: string) => jar([{ id: "flywheel", version: v, deps: [["minecraft", "required", "[1.21.1,1.21.2)", "CLIENT"], ["neoforge", "required", "[21.1.66,)", "CLIENT"], ["sodium", "optional", "[0.6.0-beta.2,)", "CLIENT"]] }]);
  const simulated = await jar([{ id: "simulated", version: "1.3.2", deps: [["create", "required", "[6.0.10,)", "BOTH"], ["flywheel", "required", "[1.0.6,)", "CLIENT"], ["sable", "required", "[2.0.0,3.0.0)", "BOTH"]] }]);
  const files: Array<[LockEntry, Buffer]> = [
    [entry("create", "both"), await jar([{ id: "create", version: "6.0.10", deps: [["flywheel", "required", "[1.0.0,2.0)", "CLIENT"], ["radium", "incompatible", ""]] }], [{ group: "dev.engine-room.flywheel", artifact: "flywheel-neoforge-1.21.1", range: "[1.0.6,2.0)", version: "1.0.6", path: "META-INF/jarjar/flywheel-neoforge-1.21.1-1.0.6.jar", jar: await flywheel("1.0.6") }])],
    [entry("create-aeronautics", "both"), await jar([{ id: "aeronautics_bundled", version: "1.3.2", deps: [["neoforge", "required", "[21.1.228,)", "BOTH"]] }], [{ group: "dev.simulated_team.simulated", artifact: "simulated", range: "[1.3.2,)", version: "1.3.2", path: "META-INF/jarjar/dev.simulated_team.simulated.simulated-neoforge-1.21.1-1.3.2.jar", jar: simulated }])],
    [entry("sable", "both"), await jar([{ id: "sable", version: "2.0.6", deps: [["flywheel", "optional", "[1.0.6,)", "CLIENT"], ["create", "optional", "[6.0.10,6.1.0)", "CLIENT"], ["sodium", "incompatible", "(,0.8.12-alpha.2+mc1.21.1)"]] }])],
    [entry("sodium", "client"), await jar([{ id: "sodium", version: "0.8.13+mc1.21.1" }])],
  ];
  if (!withAeronautics) files.splice(1, 2); // Create Aeronautics and Sable
  if (withVanillin) files.push([entry("flw-vanillin", "client"), await jar([{ id: "vanillin", version: "1.1.3", deps: [["flywheel", "required", "[1.0.0,2.0)", "CLIENT"]] }], [{ group: "dev.engine-room.flywheel", artifact: "neoforge", range: "[1.0.4,)", version: "1.0.4", path: "META-INF/jars/flywheel-neoforge-1.21.1-1.0.4.jar", jar: await flywheel("1.0.4") }])]);
  return files;
};

describe("checkPackDependencies: the two packs that passed Lock and failed on every PC", () => {
  it("2026-10-05: Xaero's maps 26.6.0 / 1.47.0 with Open Parties and Claims pinned at 0.31.6 are refused, on PCs", async () => {
    expect(errors(await pack(await xaero("26.6.0", "1.47.0", "[0.32.4,)")))).toEqual([
      "on PCs: xaerominimap 26.6.0 (xaeros-minimap) works with openpartiesandclaims [0.32.4,) only, but the pack has openpartiesandclaims 0.31.6 (open-parties-and-claims)",
      "on PCs: xaeroworldmap 1.47.0 (xaeros-world-map) works with openpartiesandclaims [0.32.4,) only, but the pack has openpartiesandclaims 0.31.6 (open-parties-and-claims)",
    ]);
  });
  it("the fix of that day (Minimap 26.5.0, World Map 1.46.0, which take 0.31.6) passes", async () => {
    expect(await pack(await xaero("26.5.0", "1.46.0", "[0.31.6,)"))).toEqual([]);
  });
  it("2026-10-20: Vanillin's Flywheel 1.0.4 beside Create's 1.0.6 is refused on PCs, naming both and what needs 1.0.6", async () => {
    const found = errors(await pack(await flywheelCase()));
    expect(found).toEqual([
      "on PCs: flywheel comes in 2 versions, and which one loads is not certain: 1.0.6 (create > flywheel-neoforge-1.21.1-1.0.6.jar, as dev.engine-room.flywheel:flywheel-neoforge-1.21.1) and 1.0.4 (flw-vanillin > flywheel-neoforge-1.21.1-1.0.4.jar, as dev.engine-room.flywheel:neoforge)",
      "on PCs: sable 2.0.6 (sable) works with flywheel [1.0.6,) only, but the pack has flywheel 1.0.4 (flw-vanillin > flywheel-neoforge-1.21.1-1.0.4.jar, as dev.engine-room.flywheel:neoforge)",
      "on PCs: simulated 1.3.2 (create-aeronautics > dev.simulated_team.simulated.simulated-neoforge-1.21.1-1.3.2.jar) requires flywheel [1.0.6,), but the pack has flywheel 1.0.4 (flw-vanillin > flywheel-neoforge-1.21.1-1.0.4.jar, as dev.engine-room.flywheel:neoforge)",
    ]);
  });
  it("without Vanillin it passes: one Flywheel, and the server never had Vanillin's", async () => {
    expect(await pack(await flywheelCase(false))).toEqual([]);
  });
  it("Create and Vanillin alone (live since October): both take flywheel [1.0.0,2.0), so the two Flywheels are a warning, not an error", async () => {
    expect(await pack(await flywheelCase(true, false))).toEqual([
      { level: "warn", message: "on PCs: flywheel comes in 2 versions, and which one loads is not certain: 1.0.6 (create > flywheel-neoforge-1.21.1-1.0.6.jar, as dev.engine-room.flywheel:flywheel-neoforge-1.21.1) and 1.0.4 (flw-vanillin > flywheel-neoforge-1.21.1-1.0.4.jar, as dev.engine-room.flywheel:neoforge); every mod that names it takes each" },
    ]);
  });
});

describe("checkPackDependencies: the rules", () => {
  const one = (slug: string, side: LockEntry["side"], id: string, version: string, deps: Dep[] = [], extra: Partial<LockEntry> = {}) => jar([{ id, version, deps }]).then((b) => [entry(slug, side, extra), b] as [LockEntry, Buffer]);

  it("a required mod that is missing, on the side that needs it only", async () => {
    const found = await pack([await one("a", "both", "a", "1", [["lib", "required", "[1,)", "SERVER"], ["gone", "required", "*"]]), await one("lib", "client", "lib", "1")]);
    expect(errors(found)).toEqual(["on PCs and the server: a 1 (a) requires gone *, which is not in the pack", "on the server: a 1 (a) requires lib [1,), which is not in the pack"]);
  });
  it("an optional mod that is not there is no problem; an incompatible one in range is; a discouraged one is a warning", async () => {
    const found = await pack([await one("a", "both", "a", "1", [["absent", "optional", "[9,)"], ["b", "incompatible", "(,2)"], ["c", "discouraged", ""]]), await one("b", "both", "b", "1.5"), await one("c", "both", "c", "3")]);
    expect(found).toEqual([
      { level: "error", message: "on PCs and the server: a 1 (a) is incompatible with b (,2), and the pack has b 1.5 (b)" },
      { level: "warn", message: "on PCs and the server: a 1 (a) discourages c any version, and the pack has c 3 (c)" },
    ]);
  });
  it("Minecraft and NeoForge are the lock's; a mod for 1.21 is accepted on 1.21.1, as NeoForge does (JEI, Alternate Current)", async () => {
    expect(await pack([await one("jei", "both", "jei", "19.51.0.418", [["minecraft", "required", "[1.21, 1.21.1)"], ["neoforge", "required", "[21.1.0,)"]])])).toEqual([]);
    expect(errors(await pack([await one("x", "both", "x", "1", [["minecraft", "required", "[1.21.2,)"], ["neoforge", "required", "[21.1.300,)"]])]))).toEqual([
      "on PCs and the server: x 1 (x) requires minecraft [1.21.2,), but the pack has minecraft 1.21.1 (Minecraft)",
      "on PCs and the server: x 1 (x) requires neoforge [21.1.300,), but the pack has neoforge 21.1.253 (NeoForge)",
    ]);
  });
  it("jar-in-jar under one identifier: the newest copy every carrier accepts loads, and none fitting is refused", async () => {
    const lib = (v: string) => jar([{ id: "lib", version: v }]);
    const carrier = async (slug: string, v: string, range: string, needs: string) => one(slug, "both", slug, "1", [["lib", "required", needs]]).then(async ([e]) => [e, await jar([{ id: slug, version: "1", deps: [["lib", "required", needs]] }], [{ group: "g", artifact: "lib", range, version: v, path: `META-INF/jarjar/lib-${v}.jar`, jar: await lib(v) }])] as [LockEntry, Buffer]);
    expect(await pack([await carrier("a", "1.2", "[1.0,)", "[1.2,)"), await carrier("b", "1.0", "[1.0,)", "[1.0,)")])).toEqual([]);
    expect(errors(await pack([await carrier("a", "1.2", "[1.2,)", "*"), await carrier("b", "1.0", "[1.0,1.1)", "*")]))).toEqual([
      "on PCs and the server: jar-in-jar g:lib: no copy fits every jar that carries it: a > lib-1.2.jar has 1.2 and accepts [1.2,); b > lib-1.0.jar has 1.0 and accepts [1.0,1.1)",
      "on PCs and the server: a 1 (a) requires lib *, which is not in the pack",
      "on PCs and the server: b 1 (b) requires lib *, which is not in the pack",
    ]);
  });
  it("a mod in the mods folder wins over a jar-in-jar copy of it: said, not refused", async () => {
    const found = await pack([await one("flywheel", "client", "flywheel", "1.0.6"), [entry("flw-vanillin", "client"), await jar([{ id: "vanillin", version: "1.1.3", deps: [["flywheel", "required", "[1.0.6,)"]] }], [{ group: "dev.engine-room.flywheel", artifact: "neoforge", range: "[1.0.4,)", version: "1.0.4", path: "META-INF/jars/fw.jar", jar: await jar([{ id: "flywheel", version: "1.0.4" }]) }])]]);
    expect(found).toEqual([{ level: "warn", message: "on PCs: flywheel: flw-vanillin > fw.jar carries 1.0.4, but 1.0.6 (flywheel) is in the mods folder and is the one that loads" }]);
  });
  it("two jars in the mods folder with one mod id are refused", async () => {
    expect(errors(await pack([await one("a", "both", "same", "1"), await one("b", "both", "same", "1")]))).toEqual(["on PCs and the server: same is in two jars of the mods folder: 1 (a) and 1 (b)"]);
  });
  it("season mods: a problem only some seasons bring says which", async () => {
    const found = await pack([await one("a", "both", "a", "1", [["s", "optional", "[2,)"]]), await one("s", "both", "s", "1", [], { season: "s1" })]);
    expect(errors(found)).toEqual(["on PCs and the server: a 1 (a) works with s [2,) only, but the pack has s 1 (s) (with Season s1 shipped)"]);
  });
  it("a jar not read: what it might hold is not taken as missing, and it is said", async () => {
    const a = await one("a", "both", "a", "1", [["b", "required", "*"]]);
    const jars = new Map<string, JarMods | null>([["a.jar", jarMods(openZip(a[1]))], ["b.jar", null]]);
    const found = checkPackDependencies({ files: [a[0], entry("b", "both")], minecraft: "1.21.1", neoforge: "21.1.253" }, jars);
    expect(found).toEqual([
      { level: "warn", message: "on PCs and the server: a 1 (a) requires b *, which none of the jars read here has (not read: b)" },
      { level: "warn", message: "dependencies: 1 of 2 jars not read, so not checked: b" },
    ]);
  });
});

describe("Lock refuses such a pack and writes nothing", () => {
  let dir = "";
  const sha = (b: Buffer, alg = "sha512") => createHash(alg).update(b).digest("hex");
  const cdn = new Map<string, Buffer>();
  const project = (id: string, slug: string, side: string) => ({ id, slug, title: slug, client_side: "required", server_side: side, loaders: ["neoforge"], game_versions: ["1.21.1"] });
  const version = (projectId: string, id: string, number: string, filename: string, body: Buffer) => {
    const url = `https://cdn.modrinth.com/data/${projectId}/versions/${id}/${filename}`;
    cdn.set(url, body);
    return { id, project_id: projectId, version_number: number, version_type: "release", date_published: `2026-10-0${number === "26.6.0" ? 5 : 1}`, loaders: ["neoforge"], game_versions: ["1.21.1"], dependencies: [], files: [{ url, filename, primary: true, size: body.length, hashes: { sha512: sha(body), sha1: sha(body, "sha1") } }] };
  };

  // The jars are built once for the whole describe: modrinth.ts keeps every answer it was given (with each file's
  // sha512) for the rest of the run, and a zip carries the time it was made, so jars built again for the next test can
  // differ from the sha512 it remembers ("opac-0.31.6.jar: sha512 mismatch", on CI when the tests ran a second apart).
  let bodies: { m266: Buffer; m265: Buffer; opac: Buffer } | null = null;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "deps-lock-"));
    const minimap = (v: string, opac: string) => jar([{ id: "xaerominimap", version: v, deps: [["openpartiesandclaims", "optional", opac, "BOTH"]] }]);
    bodies ??= { m266: await minimap("26.6.0", "[0.32.4,)"), m265: await minimap("26.5.0", "[0.31.6,)"), opac: await jar([{ id: "openpartiesandclaims", version: "0.31.6" }]) };
    const versions = {
      "1bokaNcj": [version("1bokaNcj", "irjR7dHk", "26.6.0", "xaerominimap-26.6.0.jar", bodies.m266), version("1bokaNcj", "Q1tuMQBB", "26.5.0", "xaerominimap-26.5.0.jar", bodies.m265)],
      gq2ZxDEq: [version("gq2ZxDEq", "3i48dTzz", "0.31.6", "opac-0.31.6.jar", bodies.opac)],
    };
    const projects: Record<string, object> = { "xaeros-minimap": project("1bokaNcj", "xaeros-minimap", "unsupported"), "open-parties-and-claims": project("gq2ZxDEq", "open-parties-and-claims", "required") };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url);
      const body = cdn.get(u);
      if (body) return new Response(new Uint8Array(body));
      const v = /\/project\/([^/]+)\/version\?/.exec(u)?.[1];
      if (v && v in versions) return Response.json(versions[v as keyof typeof versions]);
      const p = /\/project\/([^/?]+)$/.exec(u)?.[1];
      if (p && projects[p]) return Response.json(projects[p]);
      return new Response("not here", { status: 404 });
    }));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    cdn.clear();
    await rm(dir, { recursive: true, force: true });
  });

  const manifest = (minimap: string) => ({ minecraft: "1.21.1", loader: "neoforge", neoforge: "21.1.253", version: "0.1.0", mods: [
    { slug: "xaeros-minimap", name: "Xaero's Minimap", side: "both", enabled: true, requires: [], version: minimap },
    { slug: "open-parties-and-claims", name: "Open Parties and Claims", side: "both", enabled: true, requires: [], version: "3i48dTzz" },
  ] as unknown as Mod[] }) as unknown as Manifest;

  it("2026-10-05 again: Minimap on latest takes 26.6.0, and Lock stops with the reason", async () => {
    await expect(buildLock(manifest("latest"), { configDir: path.join(dir, "none"), jarCache: path.join(dir, "jars") })).rejects.toThrow(
      "the mods do not accept each other's versions (from each jar's neoforge.mods.toml), so nothing was written:\n  on PCs: xaerominimap 26.6.0 (xaeros-minimap) works with openpartiesandclaims [0.32.4,) only, but the pack has openpartiesandclaims 0.31.6 (open-parties-and-claims)",
    );
  });
  it("pinned to 26.5.0, as the fix did, Lock goes through", async () => {
    const { lock, warnings } = await buildLock(manifest("Q1tuMQBB"), { configDir: path.join(dir, "none"), jarCache: path.join(dir, "jars") });
    expect(lock.files.map((f) => `${f.slug} ${f.versionNumber}`)).toEqual(["open-parties-and-claims 0.31.6", "xaeros-minimap 26.5.0"]);
    expect(warnings).toEqual([]);
  });
  it("without a jar cache nothing is looked into, and Lock says so", async () => {
    const { warnings } = await buildLock(manifest("latest"), { configDir: path.join(dir, "none") });
    expect(warnings).toEqual(["no jar cache here: the jars' network channels and the versions their mods need of each other were not checked"]);
  });
});
