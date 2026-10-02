import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dashedUuid, headFile, headUrl, isFresh, isHeadPng, HEAD_FRESH_MS } from "@/lib/heads";
import { HEAD_PLACEHOLDER, HEAD_RETRY_MS, headFor } from "@/server/heads";

// docs/21 §7: the app's player heads, fetched by the site from Crafatar once a day, the grey placeholder otherwise.

const UUID = "069a79f4-44e9-4726-a5be-fca90e38aaf5";
const REPO = path.resolve(__dirname, "..", "..", "..");
const png24 = () => new Uint8Array(HEAD_PLACEHOLDER).map((b, i) => (i === 40 ? b ^ 1 : b)); // a different 24 px PNG

describe("names and checks", () => {
  it("takes a UUID with or without dashes, in any case, and nothing else", () => {
    expect(dashedUuid("069A79F444E94726A5BEFCA90E38AAF5")).toBe(UUID);
    expect(dashedUuid(UUID)).toBe(UUID);
    expect(dashedUuid("../../etc/passwd")).toBeNull();
    expect(dashedUuid(null)).toBeNull();
    expect(headFile(`${UUID}.png`)).toBe(UUID);
    expect(headFile("069a79f444e94726a5befca90e38aaf5.PNG")).toBe(UUID);
    expect(headFile(`${UUID}.png.exe`)).toBeNull();
    expect(headFile("..%2F.png")).toBeNull();
  });
  it("asks Crafatar for the 24 px avatar with the hat layer", () => {
    expect(headUrl(UUID)).toBe("https://crafatar.com/avatars/069a79f444e94726a5befca90e38aaf5?size=24&overlay");
  });
  it("keeps only a 24x24 PNG", () => {
    expect(isHeadPng(HEAD_PLACEHOLDER)).toBe(true);
    expect(isHeadPng(new TextEncoder().encode("<html>Crafatar is down</html>"))).toBe(false);
    const big = new Uint8Array(HEAD_PLACEHOLDER);
    big[19] = 64; // IHDR width 64
    expect(isHeadPng(big)).toBe(false);
  });
  it("uses a head for a day", () => {
    expect(isFresh(1000, 1000 + HEAD_FRESH_MS - 1)).toBe(true);
    expect(isFresh(1000, 1000 + HEAD_FRESH_MS)).toBe(false);
  });
  it("the placeholder is the head make-art.py drew", async () => {
    const drawn = await readFile(path.join(REPO, "branding", "launcher", "head-placeholder.png"));
    expect(Buffer.from(HEAD_PLACEHOLDER).equals(drawn)).toBe(true);
  });
});

describe("headFor", () => {
  let dir: string;
  let now: number;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "heads-"));
    now = Date.parse("2026-10-02T19:00:00Z");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });
  const ok = (data: Uint8Array) => vi.fn(async () => new Response(new Uint8Array(data), { status: 200, headers: { "content-type": "image/png" } }));
  const down = () => vi.fn(async () => new Response("down", { status: 503 }));

  it("a player who is not a member gets the placeholder and nothing is fetched", async () => {
    const get = ok(png24());
    const h = await headFor(null, { dir, fetch: get, now: () => now });
    expect(h.source).toBe("placeholder");
    expect(get).not.toHaveBeenCalled();
  });

  it("fetches once, keeps it in data/heads and answers from there for the rest of the day", async () => {
    const head = png24();
    const get = ok(head);
    const a = await headFor(UUID, { dir, fetch: get, now: () => now });
    expect(a.source).toBe("fetched");
    expect(Buffer.from(a.data).equals(Buffer.from(head))).toBe(true);
    expect(get).toHaveBeenCalledWith("https://crafatar.com/avatars/069a79f444e94726a5befca90e38aaf5?size=24&overlay", expect.anything());
    expect((await stat(path.join(dir, `${UUID}.png`))).size).toBe(head.length);
    const b = await headFor(UUID, { dir, fetch: get, now: () => Date.now() + 1000 });
    expect(b.source).toBe("cache");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("two asks at the same moment share one fetch", async () => {
    const get = ok(png24());
    const [a, b] = await Promise.all([headFor(UUID, { dir, fetch: get, now: () => now }), headFor(UUID, { dir, fetch: get, now: () => now })]);
    expect(a.source).toBe("fetched");
    expect(b.source).toBe("fetched");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("Crafatar down with nothing kept: the placeholder, and no new try for ten minutes", async () => {
    const get = down();
    expect((await headFor(UUID, { dir, fetch: get, now: () => now })).source).toBe("placeholder");
    expect((await headFor(UUID, { dir, fetch: get, now: () => now + HEAD_RETRY_MS - 1 })).source).toBe("placeholder");
    expect(get).toHaveBeenCalledTimes(1);
    const later = ok(png24());
    expect((await headFor(UUID, { dir, fetch: later, now: () => now + HEAD_RETRY_MS })).source).toBe("fetched");
  });

  it("a day old and Crafatar down: yesterday's head, not the placeholder", async () => {
    const old = png24();
    await writeFile(path.join(dir, `${UUID}.png`), old);
    const day = new Date(now - HEAD_FRESH_MS - 1000);
    await utimes(path.join(dir, `${UUID}.png`), day, day);
    const h = await headFor(UUID, { dir, fetch: down(), now: () => now + 2 * HEAD_RETRY_MS });
    expect(h.source).toBe("stale");
    expect(Buffer.from(h.data).equals(Buffer.from(old))).toBe(true);
  });

  it("an answer that is not a 24 px PNG is never kept", async () => {
    const get = vi.fn(async () => new Response("<html>oops</html>", { status: 200 }));
    const h = await headFor(UUID, { dir, fetch: get, now: () => now + 3 * HEAD_RETRY_MS });
    expect(h.source).toBe("placeholder");
    await expect(stat(path.join(dir, `${UUID}.png`))).rejects.toThrow();
  });
});
