// Sizes of an uploaded logo, without an image library.

/** Pure: a PNG's width and height from its IHDR chunk (bytes 16..24). */
export function pngSize(head: Buffer): { width: number; height: number } | null {
  if (head.length < 24 || head.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || head.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

/** Pure: is the SVG square, by its viewBox (or width and height when it has none)? */
export function svgSquare(svg: string): boolean {
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/.exec(svg);
  if (vb) return Math.abs(Number(vb[1]) - Number(vb[2])) < 1e-6 && Number(vb[1]) > 0;
  const w = /\bwidth\s*=\s*["']([\d.]+)/.exec(svg)?.[1];
  const h = /\bheight\s*=\s*["']([\d.]+)/.exec(svg)?.[1];
  return Boolean(w && h && w === h);
}
