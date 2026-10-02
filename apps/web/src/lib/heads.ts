// docs/21 §7: a 24 px head next to each name the app lists as online. The app talks to this site only, so the site
// fetches the head (Crafatar, once a day per player), keeps it under data/heads and answers it. Pure parts here.

export const HEAD_PX = 24;
export const HEAD_MAX_BYTES = 32 * 1024;
export const HEAD_FRESH_MS = 24 * 60 * 60 * 1000;
export const HEAD_FETCH_TIMEOUT_MS = 5000;

const UUID = /^([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})$/;

/** A UUID with or without dashes, any case, as the dashed lower-case form the site stores (User.mcUuid); else null. */
export function dashedUuid(raw: string | null | undefined): string | null {
  const m = UUID.exec((raw ?? "").trim().toLowerCase());
  return m ? m.slice(1).join("-") : null;
}

/** "<uuid>.png" from the address (the app asks for /api/app/head/<uuid>.png) to the dashed UUID; else null. */
export function headFile(file: string | null | undefined): string | null {
  const m = /^(.+)\.png$/i.exec(file ?? "");
  return m ? dashedUuid(m[1]) : null;
}

/** Where a head comes from: Crafatar's 24 px avatar with the hat layer, by the undashed UUID. */
export function headUrl(uuid: string): string {
  return `https://crafatar.com/avatars/${uuid.replace(/-/g, "")}?size=${HEAD_PX}&overlay`;
}

/** A PNG of exactly 24x24, read from its own bytes (the signature and the IHDR chunk), within the size limit. */
export function isHeadPng(b: Uint8Array): boolean {
  if (b.length < 24 || b.length > HEAD_MAX_BYTES) return false;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (sig.some((v, i) => b[i] !== v)) return false;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return dv.getUint32(12) === 0x49484452 /* IHDR */ && dv.getUint32(16) === HEAD_PX && dv.getUint32(20) === HEAD_PX;
}

/** A head on disk is used for a day, then fetched again. */
export function isFresh(savedAtMs: number, nowMs: number): boolean {
  return nowMs - savedAtMs >= 0 && nowMs - savedAtMs < HEAD_FRESH_MS;
}
