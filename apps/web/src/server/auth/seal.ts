import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Admins' authenticator secrets are kept encrypted (a copy of the database alone cannot make codes). The sealed string
// says which key sealed it:
//   v1  a key made from AUTH_SECRET (the only kind before TOTP_SEAL_KEY existed)
//   v2  a key made from TOTP_SEAL_KEY
// New seals are v2 whenever TOTP_SEAL_KEY is set, and a v1 row is sealed again as v2 after its next good code
// (resealed()). Once every admin has signed in once that way, AUTH_SECRET can be rotated like any session key
// without resetting anyone's authenticator. Both versions keep opening, so no row is ever stranded.

type Version = "v1" | "v2";

function keyFor(v: Version): Buffer | null {
  const secret = v === "v1" ? process.env.AUTH_SECRET : process.env.TOTP_SEAL_KEY;
  if (!secret) return null;
  return createHash("sha256").update(v === "v1" ? `deepslate:totp:${secret}` : `deepslate:totp-seal:${secret}`).digest();
}

/** The version a new seal gets: v2 when TOTP_SEAL_KEY is set. */
const current = (): Version => (process.env.TOTP_SEAL_KEY ? "v2" : "v1");

export function sealSecret(plain: string): string {
  const v = current();
  const key = keyFor(v);
  if (!key) throw new Error("AUTH_SECRET is not set");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${v}:${iv.toString("base64url")}:${c.getAuthTag().toString("base64url")}:${ct.toString("base64url")}`;
}

export function openSecret(sealed: string | null): string | null {
  if (!sealed) return null;
  const [v, iv, tag, ct] = sealed.split(":");
  if ((v !== "v1" && v !== "v2") || !iv || !tag || !ct) return null;
  const key = keyFor(v);
  if (!key) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** The same secret sealed the current way, or null when it already is (or cannot be opened). */
export function resealed(sealed: string | null): string | null {
  if (!sealed || sealed.startsWith(`${current()}:`)) return null;
  const plain = openSecret(sealed);
  return plain === null ? null : sealSecret(plain);
}
