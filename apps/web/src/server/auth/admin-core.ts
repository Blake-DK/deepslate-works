import { timingSafeEqual } from "node:crypto";
import type { AdminLockouts } from "./lockout";
import { normaliseUsername } from "./password-policy";
import { verifyTotp } from "./totp";

// Admin password sign-in (planner, 2026-10-01), the decision itself, with everything it reads and writes handed in,
// so the tests run it without a database. All three are always needed: username, password, and a 6-digit code from
// the authenticator app or one unused recovery code. Every way of failing looks the same to the person signing in.

export type RecoveryEntry = { h: string; usedAt: string | null };

export type LoginRecord = {
  userId: string;
  displayName: string;
  role: "ADMIN" | "PLAYER";
  enabled: boolean;
  passwordHash: string;
  totpSecret: string | null; // decrypted
  lastStep: number | null;
  recovery: RecoveryEntry[];
};

export type SignInDeps = {
  find(username: string): Promise<LoginRecord | null>;
  verifyPassword(hash: string, password: string): Promise<boolean>;
  /** Spends the same time as a real check when there is no such username. */
  dummyVerify(password: string): Promise<void>;
  /** Records the code's step; false when another sign-in got there first with the same code. */
  acceptStep(userId: string, step: number): Promise<boolean>;
  /** Marks recovery code `index` used; false when it already was. */
  useRecovery(userId: string, index: number): Promise<boolean>;
  hashRecovery(code: string): string;
  now(): number;
};

export type SignInInput = { username: unknown; password: unknown; code: unknown; ip: string };

export type SignInOutcome =
  | { ok: true; userId: string; displayName: string; username: string; via: "code" | "recovery"; recoveryLeft: number }
  | { ok: false; why: "locked" | "failed"; username: string; detail: string; lockedNow: boolean };

/** What the sign-in form says for every failure but a lock: never which of the three was wrong. */
export const GENERIC_FAILURE = "That didn't work. Check the username, the password and the code, and try again.";
export const LOCKED_MESSAGE = "Too many attempts. Wait 15 minutes, then try again.";

const RECOVERY_RE = /^[a-z2-7]{5}-?[a-z2-7]{5}$/;
export const normaliseRecovery = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, "").replace(/-/g, "");

export async function checkAdminSignIn(input: SignInInput, deps: SignInDeps, locks: AdminLockouts): Promise<SignInOutcome> {
  const username = normaliseUsername(input.username).slice(0, 64);
  const password = String(input.password ?? "");
  const code = String(input.code ?? "").trim();
  const now = deps.now();
  if (locks.user.lockedUntil(username, now) || locks.ip.lockedUntil(input.ip, now)) {
    return { ok: false, why: "locked", username, detail: "locked", lockedNow: false };
  }
  const fail = (detail: string): SignInOutcome => {
    const a = locks.user.fail(username, now);
    const b = locks.ip.fail(input.ip, now);
    return { ok: false, why: "failed", username, detail, lockedNow: a || b };
  };
  if (!username || !password) return fail("form not filled in");
  const rec = await deps.find(username);
  if (!rec) {
    await deps.dummyVerify(password);
    return fail("unknown username");
  }
  if (!(await deps.verifyPassword(rec.passwordHash, password))) return fail("wrong password");
  if (rec.role !== "ADMIN") return fail("not an admin");
  if (!rec.enabled || !rec.totpSecret) return fail("password sign-in not switched on");
  if (!code) return fail("no code");

  const unusedBefore = rec.recovery.filter((r) => !r.usedAt).length;
  let via: "code" | "recovery" | null = null;
  if (/^\d{6}$/.test(code)) {
    const step = verifyTotp(rec.totpSecret, code, now, rec.lastStep);
    if (step !== null && (await deps.acceptStep(rec.userId, step))) via = "code";
  } else if (RECOVERY_RE.test(code.toLowerCase().replace(/\s+/g, ""))) {
    const h = Buffer.from(deps.hashRecovery(normaliseRecovery(code)));
    const index = rec.recovery.findIndex((r) => !r.usedAt && r.h.length === h.length && timingSafeEqual(Buffer.from(r.h), h));
    if (index >= 0 && (await deps.useRecovery(rec.userId, index))) via = "recovery";
  }
  if (!via) return fail(/^\d{6}$/.test(code) ? "wrong code" : "wrong recovery code");
  locks.user.clear(username);
  const left = unusedBefore - (via === "recovery" ? 1 : 0);
  return { ok: true, userId: rec.userId, displayName: rec.displayName, username, via, recoveryLeft: left };
}
