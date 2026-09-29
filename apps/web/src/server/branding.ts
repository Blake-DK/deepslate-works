import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSection } from "@/server/site-settings";
import { imageKind, IMAGE_TYPE, MAX_IMAGE_BYTES, type ImageKind } from "@/lib/image-kind";
import { sanitizeSvg } from "@/lib/svg-sanitize";
import type { Section } from "@/shared/settings";

// docs/16 §5. The text and colours live in the Setting table; the pictures are files under data/branding,
// named after their content so a new picture gets a new address and browsers never show a stale one.

export const BRANDING_DIR = path.join(process.env.DATA_DIR ?? "/repo/data", "branding");
export const SLOTS = ["logo", "favicon", "banner"] as const;
export type Slot = (typeof SLOTS)[number];
export const FILE_NAME = /^(logo|favicon|banner)-[0-9a-f]{12}\.(png|webp|svg)$/;

export type Branding = Section<"branding"> & { logoUrl: string | null; faviconUrl: string | null; bannerUrl: string | null };

const url = (file: string) => (FILE_NAME.test(file) ? `/branding/${file}` : null);

export async function getBranding(): Promise<Branding> {
  const b = await getSection("branding");
  return { ...b, logoUrl: url(b.logo), faviconUrl: url(b.favicon), bannerUrl: url(b.banner) };
}

export type Stored = { ok: true; file: string; kind: ImageKind; bytes: number; dropped: string[] } | { ok: false; reason: string };

/** Checks what the file really is, rebuilds SVGs from the allow-list, and writes it. Returns the file name to store. */
export async function storeImage(slot: Slot, upload: File): Promise<Stored> {
  if (upload.size === 0) return { ok: false, reason: "The file is empty." };
  if (upload.size > MAX_IMAGE_BYTES) return { ok: false, reason: `The file is ${(upload.size / 1048576).toFixed(1)} MB. The most is 2 MB.` };
  let data: Buffer = Buffer.from(await upload.arrayBuffer());
  const kind = imageKind(data);
  if (!kind) return { ok: false, reason: "Use a PNG, WebP or SVG picture. (What counts is what the file is, not what it is called.)" };
  let dropped: string[] = [];
  if (kind === "svg") {
    const clean = sanitizeSvg(data.toString("utf8"));
    if (!clean.ok) return { ok: false, reason: clean.reason };
    data = Buffer.from(clean.svg, "utf8");
    dropped = clean.dropped;
  }
  const file = `${slot}-${createHash("sha256").update(data).digest("hex").slice(0, 12)}.${kind}`;
  try {
    await mkdir(BRANDING_DIR, { recursive: true });
    await writeFile(path.join(BRANDING_DIR, `${file}.part`), data, { mode: 0o644 });
    await rename(path.join(BRANDING_DIR, `${file}.part`), path.join(BRANDING_DIR, file));
  } catch (e) {
    return { ok: false, reason: `The picture could not be saved on the server (${e instanceof Error ? e.message : "unknown"}). Run deploy/deploy.sh once as root: it creates the folder.` };
  }
  return { ok: true, file, kind, bytes: data.length, dropped };
}

/** Removes pictures of a slot that are no longer the one in use. */
export async function tidy(slot: Slot, keep: string): Promise<void> {
  try {
    for (const f of await readdir(BRANDING_DIR)) if (f.startsWith(`${slot}-`) && f !== keep) await rm(path.join(BRANDING_DIR, f), { force: true });
  } catch {}
}

export async function readImage(file: string): Promise<{ data: Buffer; type: string } | null> {
  const m = FILE_NAME.exec(file);
  if (!m) return null;
  try {
    return { data: await readFile(path.join(BRANDING_DIR, file)), type: IMAGE_TYPE[m[2] as ImageKind] };
  } catch {
    return null;
  }
}
