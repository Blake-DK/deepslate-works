import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import archiver from "archiver";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modUrlProblem, privateJarOf, sitePrivateJar } from "../src/mod-url";
import { lintLock, lintManifest } from "../src/lint";
import { buildLock, diffLocks, type LockEntry, type LockFile } from "../src/lock";
import { buildServer } from "../src/build";
import type { Manifest, Mod } from "../src/schema";

// docs/58: a mod's jar kept on the VPS (data/private-jars/) instead of Modrinth's: a patched build, never published.

const SITE = "https://deepslate.dsw.test";
const NAME = "bossmod-1.21.1-1.8.2-dsw.1.jar";

function zip(files: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const a = archiver("zip", { store: true });
    const out = new PassThrough();
    const parts: Buffer[] = [];
    out.on("data", (c: Buffer) => parts.push(c));
    out.on("end", () => resolve(Buffer.concat(parts)));
    a.on("error", reject);
    a.pipe(out);
    for (const [name, body] of Object.entries(files)) a.append(Buffer.from(body), { name });
    void a.finalize();
  });
}
const sha = (b: Buffer, alg = "sha512") => createHash(alg).update(b).digest("hex");
const TOML = `modLoader = "javafml"\nlicense = "custom"\n\n[[mods]]\nmodId = "bossmod"\nversion = "1.8.2-dsw.1"\ndisplayName = "Boss Mod"\n`;

describe("modUrlProblem with the site's own /downloads/mods/", () => {
  it("lets through a private jar's bare path (the lock's form), and that site's own address for it", () => {
    expect(privateJarOf(`/downloads/mods/${NAME}`)).toBe(NAME);
    expect(modUrlProblem(`/downloads/mods/${NAME}`)).toBeNull();
    expect(modUrlProblem(`${SITE}/downloads/mods/${NAME}`, SITE)).toBeNull();
    expect(sitePrivateJar(`${SITE}/downloads/mods/${NAME}`, `${SITE}/`)).toBe(NAME);
  });

  it.each([
    ["the site's address when the site is not given (a lock never holds a host)", `${SITE}/downloads/mods/${NAME}`, undefined],
    ["another host's /downloads/mods/", `https://example.com/downloads/mods/${NAME}`, SITE],
    ["a look-alike of the site", `https://deepslate.dsw.test.evil.example/downloads/mods/${NAME}`, SITE],
    ["the site over plain http", `http://deepslate.dsw.test/downloads/mods/${NAME}`, SITE],
    ["another port", `https://deepslate.dsw.test:8443/downloads/mods/${NAME}`, SITE],
    ["a path outside /downloads/mods/", `/downloads/${NAME}`, SITE],
    ["a folder under it", `/downloads/mods/a/${NAME}`, SITE],
    ["a way out of it", "/downloads/mods/../config.zip", SITE],
    ["a query", `${SITE}/downloads/mods/${NAME}?x=1`, SITE],
    ["not a jar", "/downloads/mods/notes.txt", SITE],
    ["a protocol-relative address", `//evil.example/downloads/mods/${NAME}`, SITE],
  ])("refuses %s", (_why, url, site) => {
    expect(modUrlProblem(url, site)).not.toBeNull();
  });
});

describe("lint", () => {
  const priv = (extra: Partial<LockEntry> = {}) => ({ slug: "boss", filename: NAME, url: `/downloads/mods/${NAME}`, ...extra }) as LockEntry;

  it("takes a private jar's entry, and refuses one whose address names another file, and any other host", () => {
    expect(lintLock({ files: [priv()] })).toEqual([]);
    expect(lintLock({ files: [priv({ filename: "other.jar" })] })).toEqual([{ level: "error", message: `lock: boss: its address names ${NAME}, but its file is other.jar` }]);
    expect(lintLock({ files: [priv({ url: `${SITE}/downloads/mods/${NAME}` })] })[0]?.message).toMatch(/not on https:\/\/cdn\.modrinth\.com or this site's \/downloads\/mods\//);
  });

  it("mods.json: a private source is a file name and a sha512, and never beside a Modrinth version", async () => {
    const raw = JSON.parse(await readFile(path.join(__dirname, "../../../modpack/mods.json"), "utf8")) as { mods: Array<Record<string, unknown>> };
    const mod = raw.mods.find((m) => m.slug === "mowzies-mobs")!;
    mod.source = { private: NAME, sha512: "a".repeat(128), note: "docs/58" };
    mod.version = "latest";
    expect(lintManifest(raw).issues.filter((i) => i.level === "error")).toEqual([]);
    mod.version = "xgAXTl17";
    expect(lintManifest(raw).issues).toContainEqual({ level: "error", message: `mowzies-mobs: has a private "source" and a Modrinth "version" (xgAXTl17): take "version" out while the jar is private (docs/58)` });
    mod.version = "latest";
    mod.source = { private: "../x.jar", sha512: "a".repeat(128) };
    expect(lintManifest(raw).manifest).toBeNull();
    mod.source = { private: NAME, sha512: "A".repeat(128) };
    expect(lintManifest(raw).manifest).toBeNull();
  });
});

describe("Lock and Build with a private jar", () => {
  let dir = "";
  let jar: Buffer;
  const fetched: string[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "private-jars-"));
    await mkdir(path.join(dir, "private"), { recursive: true });
    jar = await zip({ "META-INF/neoforge.mods.toml": TOML, "a/B.class": "Êþº¾ nothing" });
    await writeFile(path.join(dir, "private", NAME), jar);
    fetched.length = 0;
    // Modrinth knows the library only; any question about the private mod is a test failure
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      fetched.push(String(url));
      if (String(url).includes("/project/8BmcQJ2H/version")) return Response.json([{ id: "Grwn5rUB", project_id: "8BmcQJ2H", version_number: "4.9.3", version_type: "release", date_published: "2026-01-01", loaders: ["neoforge"], game_versions: ["1.21.1"], dependencies: [], files: [{ url: "https://cdn.modrinth.com/data/8BmcQJ2H/versions/Grwn5rUB/geckolib.jar", filename: "geckolib.jar", primary: true, size: 3, hashes: { sha512: "1".repeat(128), sha1: "2".repeat(40) } }] }]);
      if (String(url).endsWith("/project/geckolib")) return Response.json({ id: "8BmcQJ2H", slug: "geckolib", title: "GeckoLib", client_side: "required", server_side: "required", loaders: ["neoforge"], game_versions: ["1.21.1"] });
      return new Response("not here", { status: 500 });
    }));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  const mod = (extra: Partial<Mod> = {}) => ({ slug: "boss-mod", name: "Boss Mod", side: "both", enabled: true, requires: ["geckolib"], version: "latest", source: { private: NAME, sha512: sha(jar) }, ...extra }) as Mod;
  const gecko = { slug: "geckolib", name: "GeckoLib", side: "both", enabled: true, requires: [], version: "Grwn5rUB" } as unknown as Mod;
  const manifest = (m: Mod) => ({ minecraft: "1.21.1", loader: "neoforge", neoforge: "21.1.252", version: "0.1.0", mods: [m, gecko] }) as unknown as Manifest;
  const lockWith = (m: Mod, extra: Partial<Parameters<typeof buildLock>[1]> = {}) => buildLock(manifest(m), { configDir: path.join(dir, "none"), privateDir: path.join(dir, "private"), ...extra });

  it("Lock writes the entry from the file on disk, on the site's own path, and asks Modrinth nothing about it", async () => {
    const { lock } = await lockWith(mod());
    const e = lock.files.find((f) => f.slug === "boss-mod")!;
    expect(e).toMatchObject({ filename: NAME, url: `/downloads/mods/${NAME}`, sha512: sha(jar), sha1: sha(jar, "sha1"), size: jar.length, versionNumber: "1.8.2-dsw.1", versionId: `private-${sha(jar).slice(0, 16)}`, side: "both", channels: "none", projectId: "" });
    // what it needs is what mods.json says it requires
    expect(lock.files.find((f) => f.slug === "geckolib")).toMatchObject({ requiredBy: ["boss-mod"] });
    expect(fetched.filter((u) => /boss|private/i.test(u))).toEqual([]);
    expect(lintLock(lock)).toEqual([]);
  });

  it("a new jar is a version change Lock prints like any other", async () => {
    const before = (await lockWith(mod())).lock;
    const next = await zip({ "META-INF/neoforge.mods.toml": TOML.replace("dsw.1", "dsw.2"), "a/B.class": "Êþº¾" });
    await writeFile(path.join(dir, "private", NAME), next);
    const after = (await lockWith(mod({ source: { private: NAME, sha512: sha(next) } }))).lock;
    expect(diffLocks(before, after).changed).toEqual([{ slug: "boss-mod", from: "1.8.2-dsw.1", to: "1.8.2-dsw.2" }]);
    expect(after.hash).not.toBe(before.hash);
  });

  it("check 1: a jar whose sha512 is not the one mods.json names fails Lock", async () => {
    await expect(lockWith(mod({ source: { private: NAME, sha512: "f".repeat(128) } }))).rejects.toThrow(`boss-mod: ${NAME} in ${path.join(dir, "private")} is not the jar mods.json names`);
  });

  it("a jar that is not on this machine: Lock stops, unless the lock in hand names that very file (kept, and said)", async () => {
    const { lock } = await lockWith(mod());
    await rm(path.join(dir, "private", NAME));
    await expect(lockWith(mod())).rejects.toThrow(`boss-mod: its private jar ${NAME} is not in`);
    const again = await lockWith(mod(), { previous: lock });
    expect(again.lock.files.find((f) => f.slug === "boss-mod")).toEqual(lock.files.find((f) => f.slug === "boss-mod"));
    expect(again.warnings).toContain(`boss-mod: ${NAME} is not in ${path.join(dir, "private")} here; its entry is kept from the lock as it was`);
    // another sha512 in mods.json than the kept entry's: not kept
    await expect(lockWith(mod({ source: { private: NAME, sha512: "f".repeat(128) } }), { previous: lock })).rejects.toThrow("is not in");
  });

  it("Build copies the jar for the server, fetching nothing; check 1: a missing or other file fails Build and leaves no jar", async () => {
    const { lock } = await lockWith(mod());
    const own = { ...lock, files: lock.files.filter((f) => f.slug === "boss-mod") } as LockFile;
    const paths = { dist: path.join(dir, "dist"), config: path.join(dir, "none"), server: path.join(dir, "none"), privateJars: path.join(dir, "private") };
    fetched.length = 0;
    await buildServer({ version: "0.1.0" } as Manifest, own, paths, () => {});
    expect(sha(await readFile(path.join(dir, "dist", "server", "mods", NAME)))).toBe(sha(jar));
    expect(fetched).toEqual([]);

    await rm(path.join(dir, "dist"), { recursive: true });
    await writeFile(path.join(dir, "private", NAME), Buffer.from("something else"));
    await expect(buildServer({ version: "0.1.0" } as Manifest, own, paths, () => {})).rejects.toThrow(`${NAME}: the file in ${path.join(dir, "private")} is not the one the lock names`);
    expect(await readdir(path.join(dir, "dist", "server", "mods"))).toEqual([]);

    await rm(path.join(dir, "private", NAME));
    await expect(buildServer({ version: "0.1.0" } as Manifest, own, paths, () => {})).rejects.toThrow(`${NAME}: not in ${path.join(dir, "private")}`);
    await expect(buildServer({ version: "0.1.0" } as Manifest, own, { ...paths, privateJars: undefined }, () => {})).rejects.toThrow("no folder of private jars was given");
    expect(fetched).toEqual([]);
  });
});
