import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s), what every authenticator app does by default. No library: it is 20 lines.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("not base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes, as base32 (what the manual key shows). */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpAt(secret: string, step: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const off = h[h.length - 1]! & 15;
  const n = ((h[off]! & 127) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(n % 10 ** digits).padStart(digits, "0");
}

export const stepOf = (ms: number) => Math.floor(ms / 30_000);

/**
 * The step a 6-digit code belongs to, allowing one step either side for clock drift, or null. A step at or before
 * `lastStep` (the last code accepted) is refused, so a code cannot be used twice.
 */
export function verifyTotp(secret: string, code: string, now: number, lastStep: number | null = null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const s = stepOf(now);
  for (const step of [s, s - 1, s + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const want = Buffer.from(totpAt(secret, step));
    if (timingSafeEqual(want, Buffer.from(code))) return step;
  }
  return null;
}

/** otpauth:// address for the QR code. */
export function otpauthUrl(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
