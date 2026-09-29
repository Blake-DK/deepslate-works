// What an uploaded file really is, from its first bytes. The name and the type the browser claims are ignored.
export type ImageKind = "png" | "webp" | "svg";

export function imageKind(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 2048)).replace(/^﻿/, "").trimStart();
  if (bytes.subarray(0, 4096).includes(0)) return null;
  if (/^(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE\s+svg[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return "svg";
  return null;
}

export const IMAGE_TYPE: Record<ImageKind, string> = { png: "image/png", webp: "image/webp", svg: "image/svg+xml" };
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// ---- pictures of news items: photographs and screenshots, never SVG ------------------------------------------

export type PhotoKind = "png" | "webp" | "jpg";

export function photoKind(bytes: Uint8Array): PhotoKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  const k = imageKind(bytes);
  return k === "png" || k === "webp" ? k : null;
}

export const PHOTO_TYPE: Record<PhotoKind, string> = { png: "image/png", webp: "image/webp", jpg: "image/jpeg" };
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
export const PHOTO_NAME = /^news-[0-9a-f]{16}\.(png|webp|jpg)$/;

/** The file's name: from a hash of what is in it, so the same picture is the same file and a name says nothing. */
export function photoName(sha256hex: string, kind: PhotoKind): string {
  if (!/^[0-9a-f]{64}$/.test(sha256hex)) throw new Error("not a SHA-256");
  return `news-${sha256hex.slice(0, 16)}.${kind}`;
}
