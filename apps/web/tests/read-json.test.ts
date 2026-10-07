import { describe, it, expect } from "vitest";
import { readJson } from "@/server/read-json";

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("https://deepslate.dsw.test/api/x", { method: "POST", body, headers, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit);

/** A body that arrives in chunks and never says its length; records whether the reader cancelled it. */
function chunked(chunks: number, size: number) {
  const state = { cancelled: false, sent: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (state.sent >= chunks) return c.close();
      state.sent++;
      c.enqueue(new Uint8Array(size).fill(0x61));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

describe("readJson", () => {
  it("parses a small body", async () => {
    expect(await readJson(post('{"a":12}'))).toEqual({ ok: true, body: { a: 12 } });
  });

  it("refuses a 65 KB body in one chunk", async () => {
    const r = await readJson(post("a".repeat(65 * 1024)));
    expect(r).toEqual({ ok: false, code: "too_large", status: 413 });
  });

  it("refuses by Content-Length before reading", async () => {
    const r = await readJson(post("{}", { "content-length": String(10 * 1024 * 1024) }));
    expect(r).toEqual({ ok: false, code: "too_large", status: 413 });
  });

  it("stops a chunked body that grows past the limit and cancels the reader", async () => {
    const { stream, state } = chunked(1000, 16 * 1024);
    const r = await readJson(post(stream));
    expect(r).toEqual({ ok: false, code: "too_large", status: 413 });
    expect(state.cancelled).toBe(true);
    expect(state.sent).toBeLessThan(10);
  });

  it("says not_json for a broken body", async () => {
    expect(await readJson(post("{"))).toEqual({ ok: false, code: "not_json", status: 400 });
  });

  it("reads an empty body as {}", async () => {
    expect(await readJson(post(null))).toEqual({ ok: true, body: {} });
    expect(await readJson(post("  "))).toEqual({ ok: true, body: {} });
  });

  it("takes a body up to the limit it is given", async () => {
    const body = JSON.stringify({ s: "x".repeat(100) });
    expect((await readJson(post(body), body.length)).ok).toBe(true);
    expect((await readJson(post(body), body.length - 1)).ok).toBe(false);
  });
});
