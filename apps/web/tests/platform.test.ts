import { describe, expect, it } from "vitest";
import { isWindows, WINDOWS_ONLY } from "@/lib/platform";

describe("isWindows", () => {
  it("knows Windows browsers", () => {
    expect(isWindows("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")).toBe(true);
    expect(isWindows("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0")).toBe(true);
    expect(isWindows("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0")).toBe(true);
  });
  it("knows everything else", () => {
    expect(isWindows("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")).toBe(false);
    expect(isWindows("Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0")).toBe(false);
    expect(isWindows("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")).toBe(false);
    expect(isWindows("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36")).toBe(false);
    expect(isWindows("Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; Lumia 950) Edge/15.15254")).toBe(false);
    expect(isWindows("Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One) AppleWebKit/537.36 Edge/44")).toBe(false);
    expect(isWindows("curl/8.5.0")).toBe(false);
    expect(isWindows("")).toBe(false);
    expect(isWindows(null)).toBe(false);
  });
  it("says it in one line", () => {
    expect(WINDOWS_ONLY("Deepslate Works")).toBe("Deepslate Works runs on Windows only.");
  });
});
