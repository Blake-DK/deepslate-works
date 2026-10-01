import { describe, expect, it } from "vitest";
import { motdProperty, motdRuns, visible } from "@/lib/motd";
import { pngSize, svgSquare } from "@/lib/image-size";
import { ideas, titleOf } from "@/server/logo-options";
import { DEFAULT_MOTD, DEFAULT_TAGLINE, parseSection } from "@/shared/settings";

describe("the server list's text", () => {
  it("colours as the game does: a colour code resets the styles", () => {
    expect(motdRuns("§8Deepslate Works §6· modded")).toEqual([
      { text: "Deepslate Works ", colour: "#555555", bold: false, italic: false, underline: false, strike: false },
      { text: "· modded", colour: "#FFAA00", bold: false, italic: false, underline: false, strike: false },
    ]);
    expect(motdRuns("§l§6Bold §rplain").map((r) => [r.text, r.bold, r.colour])).toEqual([["Bold ", false, "#FFAA00"], ["plain", false, "#AAAAAA"]]);
    expect(visible(DEFAULT_MOTD[1])).toBe("Create, guns, quarries · press Play on deepslate.dsw.test");
  });
  it("is written into server.properties the way Java writes it", () => {
    expect(motdProperty("§8A", "§7B")).toBe("\\u00A78A\\n\\u00A77B");
  });
  it("has the planner's defaults, and the old ones count as not set", () => {
    const b = parseSection("branding", { tagline: "Invite only. Minecraft 1.21.1 · NeoForge.", motd: "Deepslate Works" });
    expect([b.tagline, b.motd, b.motd2]).toEqual([DEFAULT_TAGLINE, DEFAULT_MOTD[0], DEFAULT_MOTD[1]]);
    expect(parseSection("branding", { tagline: "Ours" }).tagline).toBe("Ours");
    expect(parseSection("branding", {}).logoChoice).toBe("");
    expect(parseSection("branding", { logoChoice: "option:2-ore-block" }).logoChoice).toBe("option:2-ore-block");
    expect(parseSection("branding", { logoChoice: "upload:../x" }).logoChoice).toBe("");
  });
});

describe("logo files", () => {
  it("reads a PNG's size and whether an SVG is square", () => {
    const head = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(head);
    head.writeUInt32BE(512, 16);
    head.writeUInt32BE(256, 20);
    expect(pngSize(head)).toEqual({ width: 512, height: 256 });
    expect(svgSquare('<svg viewBox="0 0 16 16">')).toBe(true);
    expect(svgSquare('<svg viewBox="0 0 64 32">')).toBe(false);
    expect(svgSquare('<svg width="10" height="10">')).toBe(true);
  });
  it("names the options from the planner's README", () => {
    expect(ideas("| 2-ore-block.svg | Pixel deepslate ore block |\n| x | y |")).toEqual({ "2-ore-block": "Pixel deepslate ore block" });
    expect(titleOf("5-dw-pixel-monogram")).toBe("DW pixel monogram");
    expect(titleOf("1-cracked-block")).toBe("Cracked block");
  });
});
