import { describe, expect, it } from "vitest";
import type { Amp } from "../src/amp/client.js";
import { chunks, FileError, list, preview, stat } from "../src/files/browse.js";
import { cleanPath, contentType, downloadName, isTextLike } from "../src/files/paths.js";
import { parseSection } from "../src/shared/settings.js";

const DENIED = parseSection("files", undefined).denied;
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");

// Shapes as the live instance answered on 2026-09-29.
function fakeAmp(tree: Record<string, Array<{ Filename: string; IsDirectory?: boolean; SizeBytes?: number; Modified?: string }>>, files: Record<string, Buffer> = {}) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const amp: Amp = {
    ping: async () => {},
    getStatus: async () => { throw new Error("not used"); },
    call: async <T,>(_module: string, method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      if (method === "GetDirectoryListing") return (tree[String(params.Dir)] ?? []) as T;
      if (method === "GetFileChunk") {
        const f = files[String(params.Filename)];
        if (!f) return { Title: "File Not Found", Message: "The specified file does not exist.", StackTrace: "…" } as T;
        const part = f.subarray(Number(params.Position), Number(params.Position) + Number(params.Length));
        return { Base64Data: b64(part), BytesLength: part.length } as T;
      }
      throw new Error(`unexpected AMP call ${method}`);
    },
  };
  return { amp, calls };
}
const ROOT = [
  { Filename: "world", IsDirectory: true }, { Filename: "mods", IsDirectory: true }, { Filename: "logs", IsDirectory: true }, { Filename: "LocalBackups", IsDirectory: true },
  { Filename: "server.properties", SizeBytes: 30, Modified: "2026-09-29T03:46:02.9686659Z" }, { Filename: "whitelist.json", SizeBytes: 2 }, { Filename: "session.lock", SizeBytes: 3 }, { Filename: "server-icon.png", SizeBytes: 4021 },
];

describe("cleanPath", () => {
  it("normalises ordinary paths", () => {
    expect(cleanPath("")).toEqual({ ok: true, path: "" });
    expect(cleanPath(undefined)).toEqual({ ok: true, path: "" });
    expect(cleanPath("/config//bluemap/")).toEqual({ ok: true, path: "config/bluemap" });
    expect(cleanPath("logs/latest.log")).toEqual({ ok: true, path: "logs/latest.log" });
  });
  it("refuses anything that tries to leave, however it is written", () => {
    for (const bad of ["..", "../etc/passwd", "config/../../x", "./x", "config/./x", "~root", "a\\..\\b", "a\u0000b", "logs/\nlatest.log", "x".repeat(401)]) expect([bad, cleanPath(bad).ok]).toEqual([bad, false]);
  });
});

describe("what counts as text", () => {
  it("goes by the extension docs/16 lists, and a few bare names", () => {
    for (const n of ["server.properties", "neoforge-server.toml", "ops.json", "notes.txt", "latest.log", "jei.cfg", "webserver.conf", "config.yml", "README", "eula.txt"]) expect([n, isTextLike(n)]).toEqual([n, true]);
    for (const n of ["jei.jar", "level.dat", "server-icon.png", "2026-09-28-1.log.gz", "r.0.0.mca", ".hidden"]) expect([n, isTextLike(n)]).toEqual([n, false]);
  });
  it("names and types a download safely", () => {
    expect(contentType("a.log")).toBe("text/plain");
    expect(contentType("a.weird")).toBe("application/octet-stream");
    expect(downloadName('evil"\r\nX-Header: 1.log')).toBe("evil___X-Header_ 1.log");
    expect(downloadName("")).toBe("file");
  });
});

describe("list", () => {
  it("shows folders first and marks what is off limits", async () => {
    const { amp } = fakeAmp({ "": ROOT });
    const r = await list(amp, "", DENIED);
    expect(r.entries.map((e) => e.name)).toEqual(["LocalBackups", "logs", "mods", "world", "server-icon.png", "server.properties", "session.lock", "whitelist.json"]);
    expect(r.entries.filter((e) => e.denied).map((e) => e.name)).toEqual(["LocalBackups", "world", "session.lock"]);
    expect(r.entries.find((e) => e.name === "server.properties")).toMatchObject({ dir: false, size: 30, text: true, path: "server.properties", modified: "2026-09-29T03:46:02.9686659Z" });
  });
  it("refuses a folder on the list before asking AMP anything", async () => {
    const { amp, calls } = fakeAmp({ world: [{ Filename: "level.dat", SizeBytes: 10 }] });
    await expect(list(amp, "world", DENIED)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    await expect(list(amp, "world/region", DENIED)).rejects.toMatchObject({ code: "forbidden" });
    await expect(list(amp, "../", DENIED)).rejects.toMatchObject({ code: "validation", status: 400 });
    expect(calls).toEqual([]);
  });
  it("drops entries with a slash or '..' in the name, should AMP ever send one", async () => {
    const { amp } = fakeAmp({ "": [{ Filename: "../x" }, { Filename: ".." }, { Filename: "ok.txt", SizeBytes: 1 }] });
    expect((await list(amp, "", DENIED)).entries.map((e) => e.name)).toEqual(["ok.txt"]);
  });
  it("passes AMP's own error on", async () => {
    const amp: Amp = { ping: async () => {}, getStatus: async () => { throw new Error("x"); }, call: async <T,>() => ({ Title: "Directory Not Found", Message: "The specified directory does not exist." }) as T };
    await expect(list(amp, "nope", DENIED)).rejects.toMatchObject({ code: "not_found", status: 404 });
  });
});

describe("stat, preview and download", () => {
  const props = Buffer.from("#Minecraft server properties\nmotd=Deepslate Works\npvp=false\n");
  const tree = { "": [...ROOT.filter((e) => e.Filename !== "server.properties"), { Filename: "server.properties", SizeBytes: props.length }], world: [{ Filename: "level.dat", SizeBytes: 10 }], logs: [{ Filename: "latest.log", SizeBytes: 3_000_000 }, { Filename: "big.log", SizeBytes: 80 * 1048576 }] };

  it("reads a text file whole", async () => {
    const { amp } = fakeAmp(tree, { "server.properties": props });
    const p = await preview(amp, "server.properties", DENIED, 2048 * 1024);
    expect(p.text).toBe(props.toString());
    expect(p.truncated).toBe(false);
  });
  it("shows the head of a file over the preview limit and says so", async () => {
    const body = Buffer.alloc(3_000_000, "a");
    const { amp, calls } = fakeAmp(tree, { "logs/latest.log": body });
    const p = await preview(amp, "logs/latest.log", DENIED, 2048 * 1024);
    expect(p.shown).toBe(2048 * 1024);
    expect(p.truncated).toBe(true);
    expect(calls.filter((c) => c.method === "GetFileChunk").map((c) => c.params.Position)).toEqual([0, 524288, 1048576, 1572864]);
  });
  it("refuses world/level.dat with a clear message (docs/16 acceptance)", async () => {
    const { amp, calls } = fakeAmp(tree, { "world/level.dat": Buffer.from("secret") });
    const err = await stat(amp, "world/level.dat", DENIED).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileError);
    expect((err as FileError).status).toBe(403);
    expect((err as FileError).message).toContain("never shows or downloads");
    await expect(preview(amp, "world/level.dat", DENIED, 1e6)).rejects.toMatchObject({ code: "forbidden" });
    await expect(stat(amp, "session.lock", DENIED)).rejects.toMatchObject({ code: "forbidden" });
    await expect(stat(amp, "config/../world/level.dat", DENIED)).rejects.toMatchObject({ code: "validation" });
    expect(calls).toEqual([]);
  });
  it("will not preview something that is not text, whatever it is called", async () => {
    const { amp } = fakeAmp({ "": [{ Filename: "server-icon.png", SizeBytes: 5 }, { Filename: "fake.txt", SizeBytes: 5 }] }, { "fake.txt": Buffer.from([1, 0, 2, 0, 3]) });
    await expect(preview(amp, "server-icon.png", DENIED, 1e6)).rejects.toMatchObject({ status: 415 });
    await expect(preview(amp, "fake.txt", DENIED, 1e6)).rejects.toMatchObject({ status: 415 });
  });
  it("says so when the file is not there, or is a folder", async () => {
    const { amp } = fakeAmp(tree);
    await expect(stat(amp, "missing.txt", DENIED)).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(stat(amp, "logs", DENIED)).rejects.toMatchObject({ code: "validation" });
    await expect(stat(amp, "", DENIED)).rejects.toMatchObject({ code: "validation" });
  });
  it("hands a file out in order, in pieces, and stops at the limit", async () => {
    const body = Buffer.from(Array.from({ length: 1_300_000 }, (_, i) => i % 251));
    const { amp } = fakeAmp({}, { "mods/a.jar": body });
    const got: Buffer[] = [];
    for await (const c of chunks(amp, "mods/a.jar", body.length, 50 * 1048576)) got.push(c);
    expect(got.map((g) => g.length)).toEqual([524288, 524288, 251424]);
    expect(Buffer.concat(got).equals(body)).toBe(true);
    const capped: Buffer[] = [];
    for await (const c of chunks(amp, "mods/a.jar", body.length, 600_000)) capped.push(c);
    expect(Buffer.concat(capped).length).toBe(600_000);
  });
  it("only ever reads", async () => {
    const { amp, calls } = fakeAmp(tree, { "server.properties": props });
    await list(amp, "", DENIED);
    await preview(amp, "server.properties", DENIED, 1e6);
    expect([...new Set(calls.map((c) => c.method))].sort()).toEqual(["GetDirectoryListing", "GetFileChunk"]);
  });
});
