import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_PHOTO_BYTES, PHOTO_TYPE, photoKind, photoName, PHOTO_NAME, type PhotoKind } from "@/lib/image-kind";

// docs/05: pictures for news items. Kept under data/news (not in git, mounted into web), named after their
// content, shown to members only. What a file is, is read from its first bytes; its name and what the browser
// says it is are ignored. No SVG here: a news picture is a photograph or a screenshot.

export const NEWS_DIR = path.join(process.env.DATA_DIR ?? "/repo/data", "news");

export type StoredPhoto = { ok: true; file: string; kind: PhotoKind; bytes: number } | { ok: false; reason: string };

export async function storePhoto(upload: File): Promise<StoredPhoto> {
  if (upload.size > MAX_PHOTO_BYTES) return { ok: false, reason: `The picture is ${(upload.size / 1048576).toFixed(1)} MB. The most is ${MAX_PHOTO_BYTES / 1048576} MB.` };
  return storePhotoBytes(new Uint8Array(await upload.arrayBuffer()));
}

export async function storePhotoBytes(data: Uint8Array): Promise<StoredPhoto> {
  if (data.length > MAX_PHOTO_BYTES) return { ok: false, reason: `The picture is ${(data.length / 1048576).toFixed(1)} MB. The most is ${MAX_PHOTO_BYTES / 1048576} MB.` };
  const kind = photoKind(data);
  if (!kind) return { ok: false, reason: "That is not a PNG, JPEG or WebP picture." };
  const file = photoName(createHash("sha256").update(data).digest("hex"), kind);
  try {
    await mkdir(NEWS_DIR, { recursive: true });
    await writeFile(path.join(NEWS_DIR, `${file}.part`), data, { mode: 0o644 });
    await rename(path.join(NEWS_DIR, `${file}.part`), path.join(NEWS_DIR, file));
  } catch (e) {
    return { ok: false, reason: `The picture could not be saved (${e instanceof Error ? e.message : "unknown"}).` };
  }
  return { ok: true, file, kind, bytes: data.length };
}

export async function readPhoto(file: string): Promise<{ data: Buffer; type: string } | null> {
  const m = PHOTO_NAME.exec(file);
  if (!m) return null;
  try {
    return { data: await readFile(path.join(NEWS_DIR, file)), type: PHOTO_TYPE[m[1] as PhotoKind] };
  } catch {
    return null;
  }
}

export async function removePhoto(file: string | null | undefined): Promise<void> {
  if (!file || !PHOTO_NAME.test(file)) return;
  await rm(path.join(NEWS_DIR, file), { force: true }).catch(() => undefined);
}
