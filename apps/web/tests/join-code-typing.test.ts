import { describe, expect, it } from "vitest";
import { typedCode } from "@/shared/join-code";

// Alex, 2026-09-30: the /join box puts the hyphen in by itself as the code is typed.
describe("typing a code on /join", () => {
  it("adds the hyphen after the third character, capitals, six characters at most", () => {
    expect(typedCode("a")).toBe("A");
    expect(typedCode("ab")).toBe("AB");
    expect(typedCode("abc")).toBe("ABC-");
    expect(typedCode("ABC-2")).toBe("ABC-2");
    expect(typedCode("abc234")).toBe("ABC-234");
    expect(typedCode("ABC-2345")).toBe("ABC-234");
  });
  it("takes a pasted code in any shape", () => {
    expect(typedCode(" abc 234 ")).toBe("ABC-234");
    expect(typedCode("ABC–234")).toBe("ABC-234"); // an en dash from a phone keyboard
  });
  it("lets Backspace take the hyphen away", () => {
    expect(typedCode("ABC", true)).toBe("ABC"); // "ABC-" with the hyphen deleted
    expect(typedCode("AB", true)).toBe("AB");
  });
});
