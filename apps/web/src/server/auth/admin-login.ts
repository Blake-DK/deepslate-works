import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { apiFetch } from "@/server/api-client";
import { audit } from "@/server/events";
import { base32Encode, verifyTotp } from "./totp";
import { adminLockouts } from "./lockout";
import type { LoginRecord, RecoveryEntry, SignInDeps, SignInOutcome } from "./admin-core";
import { normaliseRecovery } from "./admin-core";
import { openSecret, resealed, sealSecret } from "./seal";

export { openSecret, sealSecret };

// Admin password sign-in (planner, 2026-10-01): storage. The password is hashed with argon2id; the authenticator
// secret is encrypted (seal.ts: with TOTP_SEAL_KEY when set, else a key made from AUTH_SECRET; a copy of the
// database alone cannot make codes); recovery codes are kept only as an HMAC.

// OWASP's argon2id settings: 19 MiB, 2 passes, 1 lane. @node-rs/argon2 uses argon2id unless told otherwise.
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
export const hashAdminPassword = (password: string) => argonHash(password, ARGON);
export const verifyAdminPassword = (hash: string, password: string) => argonVerify(hash, password).catch(() => false);
let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= argonHash("not a real password, only spends the time", ARGON));

function key(purpose: string): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createHash("sha256").update(`deepslate:${purpose}:${secret}`).digest();
}

export const hashRecovery = (code: string) => createHmac("sha256", key("recovery")).update(normaliseRecovery(code)).digest("hex");

/** 10 new recovery codes: shown once as "abcde-fghij", kept only as HMACs. */
export function newRecoveryCodes(): { codes: string[]; entries: RecoveryEntry[] } {
  const codes = Array.from({ length: 10 }, () => {
    const s = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
  return { codes, entries: codes.map((c) => ({ h: hashRecovery(c), usedAt: null })) };
}

export const recoveryOf = (v: Prisma.JsonValue): RecoveryEntry[] =>
  Array.isArray(v) ? v.filter((r): r is RecoveryEntry => Boolean(r) && typeof r === "object" && typeof (r as RecoveryEntry).h === "string").map((r) => ({ h: r.h, usedAt: r.usedAt ?? null })) : [];

export const signInDeps: SignInDeps = {
  async find(username) {
    const row = await db.adminLogin.findUnique({ where: { username }, include: { user: { select: { displayName: true, role: true } } } });
    if (!row) return null;
    const rec: LoginRecord = {
      userId: row.userId, displayName: row.user.displayName, role: row.user.role, enabled: row.enabled, passwordHash: row.passwordHash,
      totpSecret: openSecret(row.totpSecret), lastStep: row.lastStep, recovery: recoveryOf(row.recovery),
    };
    return rec;
  },
  verifyPassword: verifyAdminPassword,
  async dummyVerify(password) {
    await verifyAdminPassword(await dummyHash(), password);
  },
  async acceptStep(userId, step) {
    const r = await db.adminLogin.updateMany({ where: { userId, OR: [{ lastStep: null }, { lastStep: { lt: step } }] }, data: { lastStep: step } });
    if (r.count === 1) await resealOld(userId);
    return r.count === 1;
  },
  async useRecovery(userId, index) {
    return db.$transaction(async (tx) => {
      const row = await tx.adminLogin.findUnique({ where: { userId }, select: { recovery: true } });
      const list = recoveryOf(row?.recovery ?? []);
      if (!list[index] || list[index]!.usedAt) return false;
      list[index] = { ...list[index]!, usedAt: new Date().toISOString() };
      await tx.adminLogin.update({ where: { userId }, data: { recovery: list as unknown as Prisma.InputJsonValue } });
      return true;
    });
  },
  hashRecovery,
  now: () => Date.now(),
};

/** After a good code: a secret sealed the old way (from AUTH_SECRET) is sealed again with TOTP_SEAL_KEY (seal.ts). */
async function resealOld(userId: string): Promise<void> {
  const row = await db.adminLogin.findUnique({ where: { userId }, select: { totpSecret: true, pendingSecret: true } });
  for (const field of ["totpSecret", "pendingSecret"] as const) {
    const old = row?.[field] ?? null;
    const next = resealed(old);
    // only while the row still holds what was read: a new authenticator set up meanwhile is not overwritten
    if (old && next) await db.adminLogin.updateMany({ where: { userId, [field]: old }, data: { [field]: next } });
  }
}

/**
 * The current code of the member's own authenticator checks out (for changes that need one). Uses up the code.
 * Wrong codes count against the same 5-in-15-minutes lock as sign-in, under a key of their own.
 */
export async function confirmOwnCode(userId: string, code: string): Promise<boolean> {
  const key = `manage:${userId}`;
  if (adminLockouts.user.lockedUntil(key)) return false;
  const row = await db.adminLogin.findUnique({ where: { userId } });
  const secret = openSecret(row?.totpSecret ?? null);
  const step = row?.enabled && secret ? verifyTotp(secret, code.trim(), Date.now(), row.lastStep) : null;
  if (step !== null && (await signInDeps.acceptStep(userId, step))) {
    adminLockouts.user.clear(key);
    return true;
  }
  adminLockouts.user.fail(key);
  return false;
}

/** The country of an address, from the api's GeoLite database (the web container has none of its own). */
export async function countryOf(ip: string): Promise<string | null> {
  try {
    const r = await apiFetch<{ country: string | null }>(`/geo?ip=${encodeURIComponent(ip)}`, { timeoutMs: 1500 });
    return r.country;
  } catch {
    return null;
  }
}

/** Every attempt goes into the event log, with the address and its country. */
export async function auditSignIn(out: SignInOutcome, ip: string): Promise<void> {
  const country = await countryOf(ip);
  if (out.ok) {
    await audit({ userId: out.userId, action: "auth.adminPassword", params: { username: out.username, via: out.via, ip, country, recoveryLeft: out.recoveryLeft }, result: "OK" });
  } else {
    await audit({ action: "auth.adminPasswordFailed", params: { username: out.username, ip, country, locked: out.why === "locked", lockedNow: out.lockedNow }, result: "DENIED", detail: out.detail });
  }
}

/**
 * Password sign-in off for a member: the row goes. Sessions that came in by password (or a one-time link) end with
 * it, because each one names the password it was made with (`pa`); their Discord sessions stay.
 */
export async function removeAdminLogin(userId: string): Promise<boolean> {
  const gone = await db.adminLogin.deleteMany({ where: { userId } });
  return gone.count > 0;
}

/** Made a player: password sign-in off and every session ended, Discord ones too (planner, 2026-10-01). */
export async function onDemoted(userId: string): Promise<void> {
  await db.adminLogin.deleteMany({ where: { userId } });
  await db.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
}
