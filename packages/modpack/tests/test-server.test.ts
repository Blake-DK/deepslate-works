import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSeasons, parseShip, shipFor, shipNotice } from "../src/seasons";
import { applyTestOverlay } from "../src/build";
import { modpackPaths } from "../src/paths";

// docs/42 T5 and T6: what a Build does differently on the test server (TEST_MODE=1), and that anywhere else it does
// exactly what it did before.

const SEASONS = path.join(__dirname, "../../../modpack/seasons");
const OVERLAY = path.join(__dirname, "../../../modpack/test-overlay");
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function repo(ship: string[]) {
  const d = await mkdtemp(path.join(tmpdir(), "test-server-"));
  dirs.push(d);
  await mkdir(path.join(d, "seasons"));
  for (const f of ["sample.json", "s1.json", "entities.json"]) await writeFile(path.join(d, "seasons", f), await readFile(path.join(SEASONS, f)));
  await writeFile(path.join(d, "seasons", "index.json"), JSON.stringify({ current: "s1", ship }));
  return { seasons: path.join(d, "seasons"), dist: path.join(d, "dist"), root: d };
}
const packs = async (dist: string) => (await readdir(path.join(dist, "server", "datapacks"))).sort();

describe("SEASONS_SHIP (T5)", () => {
  it("replaces index.json's ship on the test server, and says so first", async () => {
    const env = { TEST_MODE: "1", SEASONS_SHIP: "s1" };
    expect(shipFor([], env)).toEqual(["s1"]);
    expect(shipNotice(env)).toBe("test server: the season datapacks built are SEASONS_SHIP's (s1), not index.json's ship");
    const p = await repo([]);
    expect(await buildSeasons(p, () => undefined, env)).toEqual(["s1"]);
    expect(await packs(p.dist)).toContain("deepslate-season-s1");
  });

  it("unset changes nothing: on live SEASONS_SHIP is ignored, said, and nothing is built that ship does not name", async () => {
    const env = { SEASONS_SHIP: "s1" };
    expect(shipFor([], env)).toEqual([]);
    expect(shipFor(["sample"], { TEST_MODE: "0", SEASONS_SHIP: "s1" })).toEqual(["sample"]);
    expect(shipNotice(env)).toBe("SEASONS_SHIP (s1) is ignored: only the test server builds by it. index.json's ship decides");
    expect(shipNotice({})).toBeNull();
    expect(shipNotice({ TEST_MODE: "1" })).toBeNull();
    const p = await repo([]);
    const lines: string[] = [];
    expect(await buildSeasons(p, (l) => void lines.push(l), env)).toEqual([]);
    expect(lines.at(-1)).toMatch(/none in "ship", no season datapack built/);
  });

  it("names only season files that exist, and only ids", async () => {
    expect(parseShip("s1, sample  s1 ../x")).toEqual(["s1", "sample"]);
    const p = await repo([]);
    await expect(buildSeasons(p, () => undefined, { TEST_MODE: "1", SEASONS_SHIP: "s9" })).rejects.toThrow(/SEASONS_SHIP names s9/);
  });
});

describe("modpack/test-overlay (T6)", () => {
  it("lays its files over dist/server, the README left out", async () => {
    const d = await mkdtemp(path.join(tmpdir(), "overlay-"));
    dirs.push(d);
    await mkdir(path.join(d, "server", "config", "bluemap"), { recursive: true });
    await writeFile(path.join(d, "server", "config", "bluemap", "webserver.conf"), 'enabled: true\nip: "10.77.0.2"\nport: 8100\n');
    await writeFile(path.join(d, "server", "config", "bluemap", "maps.conf"), "kept\n");
    const lines: string[] = [];
    const files = await applyTestOverlay({ dist: d, testOverlay: OVERLAY }, (l) => void lines.push(l));
    expect(files).toEqual(["config/bluemap/core.conf", "config/bluemap/webserver.conf", "config/voicechat/voicechat-server.properties"]);
    const web = await readFile(path.join(d, "server", "config", "bluemap", "webserver.conf"), "utf8");
    expect(web).toMatch(/^enabled: false$/m);
    expect(web).not.toContain("10.77.0.2");
    expect(await readFile(path.join(d, "server", "config", "bluemap", "core.conf"), "utf8")).toMatch(/^accept-download: false$/m);
    expect(await readFile(path.join(d, "server", "config", "voicechat", "voicechat-server.properties"), "utf8")).toMatch(/^port=24464$/m);
    expect(await readFile(path.join(d, "server", "config", "bluemap", "maps.conf"), "utf8")).toBe("kept\n");
    await expect(readFile(path.join(d, "server", "README.md"), "utf8")).rejects.toThrow();
    expect(lines[0]).toMatch(/^test server: laid 3 file\(s\)/);
  });

  it("unset changes nothing: the CLI lays it over only with TEST_MODE=1", async () => {
    const cli = await readFile(path.join(__dirname, "../src/cli.ts"), "utf8");
    const calls = cli.split("\n").filter((l) => l.includes("applyTestOverlay("));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/if \(process\.env\.TEST_MODE === "1" && \(what === "server" \|\| what === "all"\)\) await applyTestOverlay\(P, log\);/);
  });

  it("is where the build looks for it, and its absence is said, not an error", async () => {
    expect(modpackPaths(path.join(__dirname, "../../../modpack")).testOverlay).toBe(path.resolve(OVERLAY));
    const lines: string[] = [];
    expect(await applyTestOverlay({ dist: "/nonexistent", testOverlay: "/nonexistent/test-overlay" }, (l) => void lines.push(l))).toEqual([]);
    expect(lines).toEqual(["test server: no modpack/test-overlay/, nothing laid over the server's files"]);
  });
});
