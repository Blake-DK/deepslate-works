import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { makeIco, pixelGrid, renderSizes, SIZES } from "../src/branding";
import { windowIcon } from "../src/build";

// Branding (planner, 2026-10-01): the eight logo options in branding/logo-options, every size, the .ico.
const OPTIONS = path.resolve(__dirname, "..", "..", "..", "branding", "logo-options");

async function colours(png: Buffer): Promise<number> {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const seen = new Set<number>();
  for (let i = 0; i < data.length; i += 4) seen.add(data.readUInt32BE(i));
  return seen.size;
}

describe("logo options", () => {
  it("knows the two pixel-art ones by their 16×16 grid", async () => {
    const files = (await readdir(OPTIONS)).filter((f) => f.endsWith(".svg")).sort();
    expect(files).toHaveLength(8);
    const grids = Object.fromEntries(await Promise.all(files.map(async (f) => [f, pixelGrid(await readFile(path.join(OPTIONS, f), "utf8"))])));
    expect(grids["2-ore-block.svg"]).toBe(16);
    expect(grids["5-dw-pixel-monogram.svg"]).toBe(16);
    expect(Object.values(grids).filter((g) => g !== null)).toHaveLength(2);
  });
  it("renders every option at every size, square, with transparency", async () => {
    for (const f of (await readdir(OPTIONS)).filter((x) => x.endsWith(".svg"))) {
      const { pngs } = await renderSizes(await readFile(path.join(OPTIONS, f)), { kind: "svg", choice: f });
      for (const s of SIZES) {
        const m = await sharp(pngs.get(s)!).metadata();
        expect([f, s, m.width, m.height, m.channels]).toEqual([f, s, s, s, 4]);
      }
    }
  }, 60_000);
  it("enlarges pixel art with nearest-neighbour: no colour at 512 px that is not in the 16 px grid", async () => {
    const { pngs, pixel } = await renderSizes(await readFile(path.join(OPTIONS, "2-ore-block.svg")), { kind: "svg", choice: "2-ore-block" });
    expect(pixel).toBe(true);
    expect(await colours(pngs.get(512)!)).toBe(await colours(pngs.get(16)!));
    // a smooth logo picks up in-between colours when drawn large
    const smooth = await renderSizes(await readFile(path.join(OPTIONS, "1-cracked-block.svg")), { kind: "svg", choice: "1-cracked-block" });
    expect(smooth.pixel).toBe(false);
    expect(await colours(smooth.pngs.get(512)!)).toBeGreaterThan(await colours(smooth.pngs.get(16)!));
  }, 60_000);
});

describe("the .ico and the window icon", () => {
  it("writes a directory of PNG entries, 256 as 0", async () => {
    const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();
    const ico = makeIco([{ size: 16, png }, { size: 256, png }]);
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 2]);
    expect([ico.readUInt8(6), ico.readUInt8(22)]).toEqual([16, 0]);
    expect(ico.readUInt32LE(6 + 12)).toBe(6 + 32);
    expect(ico.subarray(38, 42).toString("latin1")).toBe("\x89PNG");
  });
  it("points Custom Window Title at the icon", () => {
    expect(windowIcon("title = 'Deepslate Works'\nicon = ''\n", "customwindowtitle/icon.png")).toBe("title = 'Deepslate Works'\nicon = 'customwindowtitle/icon.png'\n");
    expect(windowIcon("title = 'x'", "a.png")).toBe("title = 'x'\nicon = 'a.png'\n");
  });
});
