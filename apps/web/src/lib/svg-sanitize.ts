// docs/16 §5: uploaded SVGs are rebuilt from an allow-list. Anything not named here is dropped: scripts,
// styles, event handlers, foreignObject, links to other files, embedded data, doctype and entities.
// The result is also served with a Content-Security-Policy that forbids scripts, as a second fence.

const ELEMENTS = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "title", "desc", "symbol", "use", "pattern"]);
const CASED: Record<string, string> = { lineargradient: "linearGradient", radialgradient: "radialGradient", clippath: "clipPath" };
const TEXT_IN = new Set(["text", "tspan", "title", "desc"]);
// Wrappers that do nothing to the drawing: the tag goes, what is inside stays.
const UNWRAP = new Set(["a", "switch"]);
const ATTRS = new Set([
  "id", "class", "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "viewbox", "points", "transform",
  "fill", "fill-opacity", "fill-rule", "clip-rule", "clip-path", "mask", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit", "opacity", "offset", "stop-color", "stop-opacity", "gradientunits", "gradienttransform",
  "spreadmethod", "fx", "fy", "preserveaspectratio", "xmlns", "xmlns:xlink", "version", "font-family", "font-size", "font-weight", "text-anchor",
  "dominant-baseline", "letter-spacing", "dx", "dy", "href", "xlink:href", "patternunits", "patterntransform", "maskunits", "clippathunits",
  "role", "aria-label", "aria-hidden", "focusable", "color", "display", "visibility", "vector-effect", "paint-order",
]);
const ATTR_CASED: Record<string, string> = { viewbox: "viewBox", gradientunits: "gradientUnits", gradienttransform: "gradientTransform", spreadmethod: "spreadMethod", preserveaspectratio: "preserveAspectRatio", patternunits: "patternUnits", patterntransform: "patternTransform", maskunits: "maskUnits", clippathunits: "clipPathUnits" };

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+|</g;
const ATTR = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

const esc = (s: string) => s.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");

function decode(v: string): string {
  return v
    .replace(/&#x([0-9a-fA-F]+);?/g, (_, h: string) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(Math.min(Number(d), 0x10ffff)))
    .replace(/&(colon|tab|newline);/gi, (_, n: string) => ({ colon: ":", tab: "\t", newline: "\n" })[n.toLowerCase()] ?? "");
}

function safeValue(name: string, raw: string): string | null {
  const flat = decode(raw).replace(/[\s\u0000-\u001f\u007f ​-‏﻿]+/g, "").toLowerCase();
  if (/(?:javascript|vbscript|data|file|livescript|mhtml):/.test(flat) || flat.includes("expression(") || flat.includes("@import") || flat.includes("<") || flat.includes("&{")) return null;
  if (name === "href" || name === "xlink:href") return /^#[\w.:-]+$/.test(raw.trim()) ? raw.trim() : null; // only to something inside this file
  for (const m of flat.matchAll(/url\(([^)]*)\)/g)) if (!/^["']?#[\w.:-]+["']?$/.test(m[1] ?? "")) return null;
  if (name === "xmlns") return raw.trim() === "http://www.w3.org/2000/svg" ? raw.trim() : null;
  if (name === "xmlns:xlink") return raw.trim() === "http://www.w3.org/1999/xlink" ? raw.trim() : null;
  return raw.length > 20_000 && name !== "d" && name !== "points" ? null : raw;
}

export type Sanitized = { ok: true; svg: string; dropped: string[] } | { ok: false; reason: string };

export function sanitizeSvg(input: string): Sanitized {
  if (input.length > 3_000_000) return { ok: false, reason: "The file is too large." };
  const src = input.replace(/^﻿/, "");
  const out: string[] = [];
  const dropped = new Set<string>();
  const open: string[] = []; // allowed elements currently open
  let skip: { name: string; depth: number } | null = null; // inside a dropped element: nothing is kept until it closes
  let sawRoot = false;
  let closedRoot = false;

  for (const m of src.matchAll(TOKEN)) {
    const token = m[0];
    const name = m[2]?.toLowerCase();
    if (!name) {
      if (token.startsWith("<!") || token.startsWith("<?")) {
        if (/^<!(doctype|entity)/i.test(token)) dropped.add("doctype");
        continue;
      }
      if (skip || !sawRoot || closedRoot) continue;
      if (token === "<") {
        if (open.some((o) => TEXT_IN.has(o))) out.push("&lt;");
        continue;
      }
      const inText = open.some((o) => TEXT_IN.has(o));
      if (inText) out.push(esc(token));
      else if (token.trim() !== "") dropped.add("stray text");
      continue;
    }
    const closing = m[1] === "/";
    const selfClosing = m[4] === "/";
    if (skip) {
      if (name === skip.name) {
        if (closing) skip.depth--;
        else if (!selfClosing) skip.depth++;
        if (skip.depth === 0) skip = null;
      }
      continue;
    }
    if (closedRoot) continue;
    if (!ELEMENTS.has(name)) {
      dropped.add(`<${name}>`);
      if (!closing && !selfClosing && !(sawRoot && UNWRAP.has(name))) skip = { name, depth: 1 };
      continue;
    }
    if (!sawRoot && (name !== "svg" || closing)) {
      dropped.add(`<${name}> before <svg>`);
      if (!closing && !selfClosing) skip = { name, depth: 1 };
      continue;
    }
    const tag = CASED[name] ?? name;
    if (closing) {
      const at = open.lastIndexOf(name);
      if (at === -1) continue;
      while (open.length > at) {
        const n = open.pop()!;
        out.push(`</${CASED[n] ?? n}>`);
      }
      if (open.length === 0) closedRoot = true;
      continue;
    }
    const attrs: string[] = [];
    const seen = new Set<string>();
    for (const a of (m[3] ?? "").matchAll(ATTR)) {
      const key = a[1]!.toLowerCase();
      if (seen.has(key)) continue;
      if (!ATTRS.has(key)) {
        dropped.add(key.startsWith("on") ? "event handlers" : key === "style" ? "style attributes" : `${key}=`);
        continue;
      }
      const value = safeValue(key, a[2] ?? a[3] ?? a[4] ?? "");
      if (value === null) {
        dropped.add(`unsafe ${key}`);
        continue;
      }
      seen.add(key);
      attrs.push(`${ATTR_CASED[key] ?? key}="${escAttr(value)}"`);
    }
    if (name === "svg" && !sawRoot) {
      sawRoot = true;
      if (!seen.has("xmlns")) attrs.unshift('xmlns="http://www.w3.org/2000/svg"');
    }
    out.push(`<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}${selfClosing ? "/" : ""}>`);
    if (!selfClosing) open.push(name);
  }
  while (open.length) {
    const n = open.pop()!;
    out.push(`</${CASED[n] ?? n}>`);
  }
  if (!sawRoot) return { ok: false, reason: "That is not an SVG picture." };
  const svg = out.join("");
  if (!/<(path|rect|circle|ellipse|line|polyline|polygon|text|use)\b/.test(svg)) return { ok: false, reason: "After removing what isn't allowed, nothing is left to draw. Export the picture as a plain SVG, or use a PNG." };
  return { ok: true, svg, dropped: [...dropped].sort() };
}
