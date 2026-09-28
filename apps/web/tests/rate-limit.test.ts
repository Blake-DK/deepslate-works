import { describe, expect, it } from "vitest";
import { RateLimiter } from "@/server/auth/rate-limit";

describe("RateLimiter", () => {
  it("allows up to the limit inside the window, then blocks, then recovers", () => {
    const rl = new RateLimiter(3, 60_000);
    const t0 = 1_000_000;
    expect(rl.allow("ip", t0)).toBe(true);
    expect(rl.allow("ip", t0 + 1)).toBe(true);
    expect(rl.allow("ip", t0 + 2)).toBe(true);
    expect(rl.allow("ip", t0 + 3)).toBe(false);
    expect(rl.allow("other", t0 + 3)).toBe(true);
    expect(rl.allow("ip", t0 + 60_001)).toBe(true);
  });
});
