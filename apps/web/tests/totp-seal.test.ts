import { afterEach, describe, expect, it } from "vitest";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { openSecret, resealed, sealSecret } from "@/server/auth/seal";

const AUTH = "auth-secret-for-tests-only-0123456789";
const SEAL = "totp-seal-key-for-tests-only-0123456789";
const saved = { auth: process.env.AUTH_SECRET, seal: process.env.TOTP_SEAL_KEY };

function setKeys(auth: string | undefined, seal: string | undefined) {
  if (auth === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = auth;
  if (seal === undefined) delete process.env.TOTP_SEAL_KEY;
  else process.env.TOTP_SEAL_KEY = seal;
}

/** A row sealed by the code before TOTP_SEAL_KEY existed (v1, the key made from AUTH_SECRET), byte for byte. */
function sealedTheOldWay(plain: string, auth: string): string {
  const key = createHash("sha256").update(`deepslate:totp:${auth}`).digest();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64url")}:${c.getAuthTag().toString("base64url")}:${ct.toString("base64url")}`;
}

afterEach(() => setKeys(saved.auth, saved.seal));

describe("the authenticator seal", () => {
  it("opens a row sealed the old way with both keys present, and reseals it with TOTP_SEAL_KEY", () => {
    const old = sealedTheOldWay("JBSWY3DPEHPK3PXP", AUTH);
    setKeys(AUTH, SEAL);
    expect(openSecret(old)).toBe("JBSWY3DPEHPK3PXP");
    const next = resealed(old);
    expect(next?.startsWith("v2:")).toBe(true);
    expect(openSecret(next)).toBe("JBSWY3DPEHPK3PXP");
    expect(resealed(next)).toBeNull(); // already the current way
  });

  it("a new seal opens without AUTH_SECRET, so rotating AUTH_SECRET keeps the authenticator", () => {
    setKeys(AUTH, SEAL);
    const sealed = sealSecret("JBSWY3DPEHPK3PXP");
    expect(sealed.startsWith("v2:")).toBe(true);
    setKeys(undefined, SEAL);
    expect(openSecret(sealed)).toBe("JBSWY3DPEHPK3PXP");
    setKeys("a-new-auth-secret-after-rotation-000", SEAL);
    expect(openSecret(sealed)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("without TOTP_SEAL_KEY seals as before (v1) and does not reseal", () => {
    setKeys(AUTH, undefined);
    const sealed = sealSecret("JBSWY3DPEHPK3PXP");
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(openSecret(sealed)).toBe("JBSWY3DPEHPK3PXP");
    expect(resealed(sealed)).toBeNull();
  });

  it("a wrong key or a broken string opens nothing", () => {
    setKeys(AUTH, SEAL);
    const sealed = sealSecret("JBSWY3DPEHPK3PXP");
    setKeys(AUTH, "another-seal-key-0123456789-abcdefgh");
    expect(openSecret(sealed)).toBeNull();
    expect(openSecret("v3:a:b:c")).toBeNull();
    expect(openSecret("v2:only")).toBeNull();
    expect(resealed(sealed)).toBeNull();
  });
});
