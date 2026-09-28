import { describe, expect, it } from "vitest";
import { MC_USERNAME_RE } from "@/server/auth/constants";
import { formatUuid } from "@/server/mojang";

describe("Minecraft identity", () => {
  it("accepts real usernames and rejects junk", () => {
    expect(MC_USERNAME_RE.test("Alex_123")).toBe(true);
    expect(MC_USERNAME_RE.test("ab")).toBe(false);
    expect(MC_USERNAME_RE.test("a".repeat(17))).toBe(false);
    expect(MC_USERNAME_RE.test("bad name")).toBe(false);
    expect(MC_USERNAME_RE.test("say hi; op me")).toBe(false);
  });
  it("formats Mojang's undashed uuid", () => {
    expect(formatUuid("069a79f444e94726a5befca90e38aaf5")).toBe("069a79f4-44e9-4726-a5be-fca90e38aaf5");
    expect(() => formatUuid("nope")).toThrow();
  });
});
