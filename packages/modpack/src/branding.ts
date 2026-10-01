import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Branding (planner, 2026-10-01): every size of the chosen logo, made from one source picture at Build.
// Source: dist/branding/source.svg or source.png plus source.json, written by api when an admin picks a logo in
// Admin → Branding. Out: dist/branding/logo-<size>.png, logo.ico, branding.json. sharp is already this package's
// dependency (extras icons), so no new one: SVG through its librsvg, PNG resized.
//
// Pixel art (a 16×16 grid, e.g. 2-ore-block.svg and 5-dw-pixel-monogram.svg) is drawn once at its own grid size and
// then only ever enlarged by whole pixels with nearest-neighbour, never smoothed.

export const SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 512] as const;
export const ICO_SIZES = [16, 32, 48, 64, 128, 256] as const;
export type Source = { kind: "svg" | "png"; choice: string; pixel?: boolean };
export type BrandingInfo = { choice: string; hash: string; pixel: boolean; sizes: number[]; builtAt: string };

/** Pure: is this SVG drawn on a small square pixel grid (viewBox 0 0 N N, N ≤ 64, crisp edges)? Returns N or null. */
export function pixelGrid(svg: string): number | null {
  const vb = /viewBox\s*=\s*["']\s*0\s+0\s+(\d{1,3})\s+(\d{1,3})\s*["']/.exec(svg);
  if (!vb || vb[1] !== vb[2]) return null;
  const n = Number(vb[1]);
  return n <= 64 && /shape-rendering\s*=\s*["']crispEdges["']/.test(svg) ? n : null;
}

/** Pure: a .ico holding PNG images (Vista and later read PNG entries; 256 is written as 0 in the directory). */
export function makeIco(images: Array<{ size: number; png: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach((img, i) => {
    const o = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, o);
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, o + 1);
    dir.writeUInt8(0, o + 2); // palette
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(img.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += img.png.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

/** Every size as PNG. */
export async function renderSizes(data: Buffer, source: Source): Promise<{ pngs: Map<number, Buffer>; pixel: boolean }> {
  const sharp = (await import("sharp")).default;
  const pngs = new Map<number, Buffer>();
  const clear = { r: 0, g: 0, b: 0, alpha: 0 };
  if (source.kind === "svg") {
    const svg = data.toString("utf8");
    const grid = source.pixel === false ? null : pixelGrid(svg);
    if (grid) {
      // the grid itself, one pixel per cell, then whole-pixel enlargements
      const base = await sharp(Buffer.from(setSize(svg, grid))).resize(grid, grid, { fit: "fill", kernel: "nearest" }).ensureAlpha().png().toBuffer();
      for (const s of SIZES) pngs.set(s, await sharp(base).resize(s, s, { kernel: "nearest" }).png({ compressionLevel: 9 }).toBuffer());
      return { pngs, pixel: true };
    }
    for (const s of SIZES) pngs.set(s, await sharp(Buffer.from(setSize(svg, s))).resize(s, s, { fit: "contain", background: clear }).ensureAlpha().png({ compressionLevel: 9 }).toBuffer());
    return { pngs, pixel: false };
  }
  const img = sharp(data).ensureAlpha();
  const meta = await img.metadata();
  // a small square PNG (≤ 64 px) is taken as pixel art too, unless the admin said otherwise
  const pixel = source.pixel ?? ((meta.width ?? 999) <= 64 && meta.width === meta.height);
  for (const s of SIZES) pngs.set(s, await sharp(data).ensureAlpha().resize(s, s, { fit: "contain", background: clear, kernel: pixel ? "nearest" : "lanczos3" }).png({ compressionLevel: 9 }).toBuffer());
  return { pngs, pixel };
}

/** The SVG with its width and height set, so librsvg draws it at exactly that size (the viewBox stays). */
function setSize(svg: string, size: number): string {
  return svg.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => `<svg${attrs.replace(/\s(width|height)\s*=\s*["'][^"']*["']/g, "")} width="${size}" height="${size}">`);
}

/** Build target "branding": reads dist/branding/source.*, writes every size, the .ico and branding.json. */
export async function buildBranding(dist: string, log: (s: string) => void): Promise<BrandingInfo | null> {
  const dir = path.join(dist, "branding");
  let source: Source;
  try {
    source = JSON.parse(await readFile(path.join(dir, "source.json"), "utf8")) as Source;
  } catch {
    log("branding: no logo chosen yet, nothing to make");
    return null;
  }
  const data = await readFile(path.join(dir, `source.${source.kind}`));
  const { pngs, pixel } = await renderSizes(data, source);
  await mkdir(dir, { recursive: true });
  const put = async (name: string, buf: Buffer) => {
    await writeFile(path.join(dir, `${name}.part`), buf, { mode: 0o644 });
    await rename(path.join(dir, `${name}.part`), path.join(dir, name));
  };
  for (const [s, png] of pngs) await put(`logo-${s}.png`, png);
  await put("logo.ico", makeIco(ICO_SIZES.map((s) => ({ size: s, png: pngs.get(s)! }))));
  const info: BrandingInfo = { choice: source.choice, hash: createHash("sha256").update(data).digest("hex").slice(0, 12), pixel, sizes: [...SIZES], builtAt: new Date().toISOString() };
  await put("branding.json", Buffer.from(JSON.stringify(info, null, 2) + "\n"));
  log(`branding: ${source.choice} (${pixel ? "pixel art, nearest-neighbour" : "smooth"}), ${SIZES.length} sizes + logo.ico`);
  return info;
}
