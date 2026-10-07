import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modUrlProblem } from "../src/mod-url";
import { lintLock } from "../src/lint";
import { buildServer } from "../src/build";
import type { LockEntry, LockFile } from "../src/lock";
import type { Manifest } from "../src/schema";

const CDN = "https://cdn.modrinth.com/data/AANobbMI/versions/OihdIimA/sodium-neoforge-0.6.13.jar";

describe("modUrlProblem", () => {
  it("lets an address on Modrinth's CDN through", () => {
    expect(modUrlProblem(CDN)).toBeNull();
  });

  it.each([
    ["plain http", "http://cdn.modrinth.com/data/x/versions/y/z.jar"],
    ["a look-alike host", "https://cdn.modrinth.com.evil.example/data/x/versions/y/z.jar"],
    ["another host", "https://example.com/a.jar"],
    ["a subdomain", "https://x.cdn.modrinth.com/a.jar"],
    ["not an address", "not a url"],
  ])("refuses %s", (_why, url) => {
    expect(modUrlProblem(url)).toMatch(/cdn\.modrinth\.com|not an address/);
  });
});

describe("lintLock", () => {
  it("names every file not on the CDN, and only those", () => {
    const files = [{ slug: "sodium", url: CDN }, { slug: "bad", url: "https://example.com/bad.jar" }] as LockEntry[];
    expect(lintLock({ files })).toEqual([{ level: "error", message: "lock: bad: not on https://cdn.modrinth.com: https://example.com/bad.jar" }]);
  });
});

describe("Build and a lock with a foreign address", () => {
  let dir = "";
  afterEach(async () => {
    vi.unstubAllGlobals();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("fails with the file's name and address before anything is fetched", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mod-url-"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const bad = { slug: "bad", filename: "bad-1.0.jar", side: "both", sha512: "0".repeat(128), url: "https://example.com/bad-1.0.jar" };
    const lock = { files: [bad], hash: "abcdef0123456789", neoforge: "21.1.252" } as unknown as LockFile;
    await expect(
      buildServer({ version: "0.0.1" } as Manifest, lock, { dist: path.join(dir, "dist"), config: path.join(dir, "none"), server: path.join(dir, "none") }, () => {}),
    ).rejects.toThrow("bad-1.0.jar: not on https://cdn.modrinth.com: https://example.com/bad-1.0.jar");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await readdir(path.join(dir, "dist", "server", "mods")).catch(() => [])).toEqual([]);
  });
});
