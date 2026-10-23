import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepAlive } from "@/server/sse";

// doc 62 §3.1: a build or a sync is one long response that can stay silent for 15 minutes; every hop in front of web
// must see something. A comment line every 15 s does it, and the browser ignores it.

describe("the SSE keep-alive", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends a comment line every 15 s until stopped, and nothing after", () => {
    const got: string[] = [];
    const stop = keepAlive((c) => got.push(new TextDecoder().decode(c)));
    vi.advanceTimersByTime(14_999);
    expect(got).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(got).toEqual([": ping\n\n"]);
    vi.advanceTimersByTime(30_000);
    expect(got).toHaveLength(3);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(got).toHaveLength(3);
  });

  it("stops by itself once the stream is closed (enqueue throws)", () => {
    let calls = 0;
    keepAlive(() => { calls++; throw new TypeError("Invalid state: Controller is already closed"); }, 1_000);
    vi.advanceTimersByTime(5_000);
    expect(calls).toBe(1);
  });
});
