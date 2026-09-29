import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJar, sha512File } from "../src/download";
import type { LockEntry } from "../src/lock";

const body = Buffer.alloc(3 * 1024 * 1024, 7);
const sha512 = createHash("sha512").update(body).digest("hex");
const entry = { filename: "a.jar", url: "https://cdn.example/a.jar", sha512 } as LockEntry;

function chunked(buf: Buffer, size = 64 * 1024) {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (at >= buf.length) return c.close();
      c.enqueue(buf.subarray(at, (at += size)));
    },
  });
}

describe("fetchJar", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jar-"));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  it("streams to disk, verifies the hash and leaves no temp file", async () => {
    const fetchMock = vi.fn(async () => new Response(chunked(body)));
    vi.stubGlobal("fetch", fetchMock);
    const dest = path.join(dir, "mods", "a.jar");
    const lines: string[] = [];
    expect(await fetchJar(entry, dest, (l) => lines.push(l))).toBe("downloaded");
    expect((await readFile(dest)).equals(body)).toBe(true);
    expect(await readdir(path.dirname(dest))).toEqual(["a.jar"]);
    expect(lines).toEqual(["downloaded a.jar (3.0 MB)"]);
    expect(await sha512File(dest)).toBe(sha512);
  });

  it("does not download again when the file on disk already matches", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const dest = path.join(dir, "a.jar");
    await writeFile(dest, body);
    expect(await fetchJar(entry, dest)).toBe("cached");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a body with the wrong hash and cleans up", async () => {
    // fresh body per try; real timers (the retry backoff is 1 s + 2 s)
    const fetchMock = vi.fn(async () => new Response(chunked(Buffer.from("not the jar"))));
    vi.stubGlobal("fetch", fetchMock);
    const dest = path.join(dir, "a.jar");
    await expect(fetchJar(entry, dest)).rejects.toThrow("a.jar: sha512 mismatch");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await readdir(dir)).toEqual([]);
  }, 15_000);
});
