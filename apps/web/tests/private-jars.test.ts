import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// docs/58: a mod's private jar, handed out by the site itself at /downloads/mods/<file>, gated like the mod list.

const NAME = "bossmod-1.21.1-1.8.2-dsw.1.jar";
const JAR = Buffer.from("PK a patched jar");
const sha512 = (b: Buffer) => createHash("sha512").update(b).digest("hex");
const s = vi.hoisted(() => ({
  dir: "",
  token: null as string | null,
  user: null as null | { id: string; role: string },
  gate: { ok: false, reason: "anonymous" } as { ok: boolean; reason: string },
  lock: null as null | { files: Array<Record<string, unknown>> },
  logged: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/server/launcher", () => ({ bearer: () => s.token, userFromLauncherToken: async (t: string | null) => (t ? s.user : null) }));
vi.mock("@/server/auth/session", () => ({ loadCurrentUser: async () => null }));
vi.mock("@/server/modpack/gate", () => ({ canDownload: async () => s.gate }));
vi.mock("@/server/modpack/lock", () => ({ getLock: async () => s.lock, P: { get privateJars() { return s.dir; } } }));
vi.mock("@/server/download-log", () => ({ logDownload: async (e: Record<string, unknown>) => { s.logged.push(e); } }));

s.dir = mkdtempSync(path.join(tmpdir(), "private-jars-web-"));
mkdirSync(s.dir, { recursive: true });
afterAll(() => rmSync(s.dir, { recursive: true, force: true }));

const entry = (extra: Record<string, unknown> = {}) => ({ slug: "boss-mod", filename: NAME, url: `/downloads/mods/${NAME}`, sha512: sha512(JAR), size: JAR.length, versionNumber: "1.8.2-dsw.1", ...extra });
const get = async (file: string) => (await import("@/app/downloads/mods/[file]/route")).GET(new Request(`https://deepslate.dsw.test/downloads/mods/${file}`), { params: Promise.resolve({ file }) });

beforeEach(() => {
  writeFileSync(path.join(s.dir, NAME), JAR);
  s.token = "t".repeat(32);
  s.user = { id: "u1", role: "PLAYER" };
  s.gate = { ok: true, reason: "online" };
  s.lock = { files: [entry()] };
  s.logged = [];
});

describe("/downloads/mods/<file> (check 2)", () => {
  it("401 without a token (or one that is no good), and nothing logged as a download", async () => {
    s.token = null;
    s.gate = { ok: false, reason: "anonymous" };
    const r = await get(NAME);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: { code: "unauthorized", message: "Sign in first" } });
    s.token = "bad".padEnd(32, "x");
    s.user = null;
    expect((await get(NAME)).status).toBe(401);
    expect(s.logged).toEqual([]);
  });

  it("the jar with one, logged with its version", async () => {
    const r = await get(NAME);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/java-archive");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await r.arrayBuffer()).equals(JAR)).toBe(true);
    expect(s.logged).toEqual([expect.objectContaining({ userId: "u1", what: "file", via: "installer", file: `mods/${NAME}`, size: JAR.length, version: "1.8.2-dsw.1" })]);
  });

  it("a player while downloads are shut to them: refused and logged, as the mod list", async () => {
    s.gate = { ok: false, reason: "offline" };
    const r = await get(NAME);
    expect(r.status).toBe(403);
    expect(s.logged).toEqual([expect.objectContaining({ file: `mods/${NAME}`, refused: "server_offline" })]);
  });

  it("404 for a name not in the lock, a Modrinth file of the lock, a season this server does not ship, a path, or a jar that is not the lock's", async () => {
    expect((await get("other.jar")).status).toBe(404);
    s.lock = { files: [entry({ url: `https://cdn.modrinth.com/data/x/versions/y/${NAME}` })] };
    expect((await get(NAME)).status).toBe(404);
    s.lock = { files: [] }; // getLock is the shipped lock: another season's jar is not in it
    expect((await get(NAME)).status).toBe(404);
    s.lock = { files: [entry()] };
    expect((await get("..%2Fconfig.zip")).status).toBe(404);
    writeFileSync(path.join(s.dir, NAME), "something else");
    expect((await get(NAME)).status).toBe(404);
    rmSync(path.join(s.dir, NAME));
    expect((await get(NAME)).status).toBe(404);
  });
});

describe("the address the app is given", () => {
  it("a private jar's path made whole on the site's own address; the test pack's through /downloads/mods/test/; Modrinth's as it is", async () => {
    const { fileUrl, testFileUrl } = await import("@/lib/private-jar-urls");
    const cdn = "https://cdn.modrinth.com/data/x/versions/y/create.jar";
    expect(fileUrl(`/downloads/mods/${NAME}`, "https://deepslate.dsw.test")).toBe(`https://deepslate.dsw.test/downloads/mods/${NAME}`);
    expect(fileUrl(`/downloads/mods/${NAME}`, "https://deepslate.dsw.test/")).toBe(`https://deepslate.dsw.test/downloads/mods/${NAME}`);
    expect(testFileUrl(`/downloads/mods/${NAME}`, "https://deepslate.dsw.test")).toBe(`https://deepslate.dsw.test/downloads/mods/test/${NAME}`);
    expect(fileUrl(cdn, "https://deepslate.dsw.test")).toBe(cdn);
    expect(testFileUrl(cdn, "https://deepslate.dsw.test")).toBe(cdn);
    // a lock that names a host for it is not made into anything (lint, Build and the app refuse it)
    expect(fileUrl(`https://example.com/downloads/mods/${NAME}`, "https://deepslate.dsw.test")).toBe(`https://example.com/downloads/mods/${NAME}`);
  });
});
