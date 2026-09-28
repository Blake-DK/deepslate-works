import { describe, expect, it } from "vitest";
import { safeNext } from "@/server/auth/next-url";

const HOME = "https://deepslate.dsw.test";

describe("safeNext", () => {
  it("keeps relative paths and blocks protocol-relative ones", () => {
    expect(safeNext("/admin", HOME)).toBe("/admin");
    expect(safeNext("//evil.example", HOME)).toBe("/");
  });
  it("allows the map subdomain and refuses other hosts", () => {
    expect(safeNext("https://map.deepslate.dsw.test/x?y=1", HOME)).toBe("https://map.deepslate.dsw.test/x?y=1");
    expect(safeNext("https://deepslate.dsw.test/", HOME)).toBe("https://deepslate.dsw.test/");
    expect(safeNext("https://evil.example/", HOME)).toBe("/");
    expect(safeNext("https://notdeepslate.dsw.test/", HOME)).toBe("/");
    expect(safeNext("http://map.deepslate.dsw.test/", HOME)).toBe("/");
    expect(safeNext(null, HOME)).toBe("/");
  });
});
