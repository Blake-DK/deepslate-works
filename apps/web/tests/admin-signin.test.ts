import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkAdminSignIn, GENERIC_FAILURE, LOCKED_MESSAGE, type LoginRecord, type SignInDeps } from "@/server/auth/admin-core";
import { ADMIN_SIGNIN_LIMITS, newAdminLockouts } from "@/server/auth/lockout";
import { base32Encode, totpAt, stepOf, verifyTotp, otpauthUrl } from "@/server/auth/totp";
import { passwordProblem } from "@/server/auth/password-policy";
import { sessionProblem } from "@/server/auth/session-check";
import { tokenExpired, SHORT_SESSION_MS } from "@/auth.config";
import { describeAction, kindOf } from "@/shared/events";

// Admin password sign-in (planner, 2026-10-01).

const SECRET = base32Encode(Buffer.from("12345678901234567890"));
const T0 = 1_790_000_000_000; // a fixed "now"
const hashRec = (c: string) => createHmac("sha256", "test").update(c.replace(/-/g, "")).digest("hex");

function world(over: Partial<LoginRecord> = {}) {
  const rec: LoginRecord = {
    userId: "u1", displayName: "Alex", role: "ADMIN", enabled: true, passwordHash: "hash:correct horse battery staple",
    totpSecret: SECRET, lastStep: null, recovery: [{ h: hashRec("abcde-fghij"), usedAt: null }, { h: hashRec("kkkkk-mmmmm"), usedAt: null }], ...over,
  };
  let now = T0;
  const calls = { dummy: 0 };
  const deps: SignInDeps = {
    find: async (u) => (u === "alex" ? rec : null),
    verifyPassword: async (h, p) => h === `hash:${p}`,
    dummyVerify: async () => void calls.dummy++,
    acceptStep: async (_id, step) => {
      if (rec.lastStep !== null && step <= rec.lastStep) return false;
      rec.lastStep = step;
      return true;
    },
    useRecovery: async (_id, i) => {
      if (rec.recovery[i]!.usedAt) return false;
      rec.recovery[i] = { ...rec.recovery[i]!, usedAt: "now" };
      return true;
    },
    hashRecovery: hashRec,
    now: () => now,
  };
  return { rec, deps, locks: newAdminLockouts(), calls, setNow: (t: number) => (now = t), code: (t = now) => totpAt(SECRET, stepOf(t)) };
}
const PW = "correct horse battery staple";
const go = (w: ReturnType<typeof world>, over: Partial<{ username: string; password: string; code: string; ip: string }> = {}) =>
  checkAdminSignIn({ username: "alex", password: PW, code: w.code(), ip: "1.2.3.4", ...over }, w.deps, w.locks);

describe("TOTP (RFC 6238)", () => {
  it("matches the RFC's SHA-1 test vectors (last 6 digits)", () => {
    expect(totpAt(SECRET, stepOf(59_000))).toBe("287082");
    expect(totpAt(SECRET, stepOf(1_111_111_109_000))).toBe("081804");
    expect(totpAt(SECRET, stepOf(2_000_000_000_000))).toBe("279037");
  });
  it("allows one step either side, refuses further and refuses a step already used", () => {
    const now = 2_000_000_000_000;
    expect(verifyTotp(SECRET, totpAt(SECRET, stepOf(now) - 1), now)).toBe(stepOf(now) - 1);
    expect(verifyTotp(SECRET, totpAt(SECRET, stepOf(now) + 1), now)).toBe(stepOf(now) + 1);
    expect(verifyTotp(SECRET, totpAt(SECRET, stepOf(now) - 2), now)).toBeNull();
    expect(verifyTotp(SECRET, totpAt(SECRET, stepOf(now)), now, stepOf(now))).toBeNull();
    expect(verifyTotp(SECRET, "12345", now)).toBeNull();
  });
  it("makes an otpauth address for the QR code", () => {
    expect(otpauthUrl("ABC", "alex", "Deepslate Works")).toBe("otpauth://totp/Deepslate%20Works%3Aalex?secret=ABC&issuer=Deepslate%20Works&algorithm=SHA1&digits=6&period=30");
  });
});

describe("checkAdminSignIn", () => {
  it("username + password + current code: in", async () => {
    const out = await go(world());
    expect(out).toMatchObject({ ok: true, userId: "u1", via: "code" });
  });
  it("no code, or no authenticator set up: refused, with no password-only path", async () => {
    expect(await go(world(), { code: "" })).toMatchObject({ ok: false, why: "failed", detail: "no code" });
    const noTotp = world({ totpSecret: null, enabled: false });
    expect(await go(noTotp)).toMatchObject({ ok: false, detail: "password sign-in not switched on" });
    expect(await go(world({ enabled: false }))).toMatchObject({ ok: false });
  });
  it("wrong code: refused; the same right code twice: refused the second time", async () => {
    const w = world();
    expect(await go(w, { code: w.code() === "000000" ? "111111" : "000000" })).toMatchObject({ ok: false, detail: "wrong code" });
    expect(await go(w)).toMatchObject({ ok: true });
    expect(await go(w)).toMatchObject({ ok: false, detail: "wrong code" });
  });
  it("a recovery code works once, with or without the dash, and counts what is left", async () => {
    const w = world();
    expect(await go(w, { code: "ABCDE-FGHIJ" })).toMatchObject({ ok: true, via: "recovery", recoveryLeft: 1 });
    expect(await go(w, { code: "abcdefghij" })).toMatchObject({ ok: false, detail: "wrong recovery code" });
    expect(await go(w, { code: "kkkkk mmmmm" })).toMatchObject({ ok: true, via: "recovery", recoveryLeft: 0 });
  });
  it("wrong username, wrong password, wrong code: all the same kind of failure; an unknown username still spends the time", async () => {
    const w = world();
    const a = await go(w, { username: "nobody" });
    const b = await go(w, { password: "not the password at all" });
    const c = await go(w, { code: "999999" === w.code() ? "888888" : "999999" });
    for (const o of [a, b, c]) expect(o).toMatchObject({ ok: false, why: "failed" });
    expect(w.calls.dummy).toBe(1);
    expect(GENERIC_FAILURE).not.toMatch(/username is|password is|code is|not found|unknown/i);
  });
  it("a player (made one after setting it up) is refused even with everything right", async () => {
    expect(await go(world({ role: "PLAYER" }))).toMatchObject({ ok: false, detail: "not an admin" });
  });
  it("5 failures for a username lock it for 15 minutes, even for the right password and code; then it opens again", async () => {
    const w = world();
    for (let i = 0; i < 4; i++) expect(await go(w, { password: "wrong password!!", ip: `10.0.0.${i}` })).toMatchObject({ why: "failed", lockedNow: false });
    expect(await go(w, { password: "wrong password!!", ip: "10.0.0.9" })).toMatchObject({ why: "failed", lockedNow: true });
    expect(await go(w)).toMatchObject({ ok: false, why: "locked" });
    w.setNow(T0 + ADMIN_SIGNIN_LIMITS.perUsername.lockMs + 1000);
    expect(await go(w)).toMatchObject({ ok: true });
    expect(LOCKED_MESSAGE).toMatch(/15 minutes/);
  });
  it("20 failures from one address lock that address, whatever username it tries", async () => {
    const w = world();
    for (let i = 0; i < 20; i++) await go(w, { username: `guess${i}` });
    expect(await go(w)).toMatchObject({ ok: false, why: "locked" });
    expect(await go(w, { ip: "5.6.7.8" })).toMatchObject({ ok: true });
  });
  it("only failures count: a success clears the username's count", async () => {
    const w = world();
    for (let i = 0; i < 4; i++) await go(w, { password: "wrong password!!" });
    w.setNow(T0 + 31_000);
    expect(await go(w)).toMatchObject({ ok: true });
    expect(w.locks.user.failures("alex", T0 + 31_000)).toBe(0);
  });
});

describe("passwords", () => {
  it("at least 12 characters, not common, not the username, not one character repeated", () => {
    expect(passwordProblem("short", "alex")).toMatch(/12/);
    expect(passwordProblem("1q2w3e4r5t6y", "alex")).toMatch(/common/);
    expect(passwordProblem("aaaaaaaaaaaaaaa", "alex")).toBeTruthy();
    expect(passwordProblem("alexalexalex12", "alex")).toMatch(/username/);
    expect(passwordProblem("Minecraft123", "alex")).toBeTruthy();
    expect(passwordProblem("tidy-otter-blanket-91", "alex")).toBeNull();
  });
});

describe("sessions", () => {
  const owner = (over = {}) => ({ role: "ADMIN" as const, sessionVersion: 0, adminLogin: { enabled: true, passwordAt: new Date(5000) }, ...over });
  it("a raised session version ends every session (made a player)", () => {
    expect(sessionProblem({ sv: 0, via: "discord" }, owner())).toBeNull();
    expect(sessionProblem({ via: "discord" }, owner())).toBeNull(); // sessions from before sv existed
    expect(sessionProblem({ sv: 0, via: "discord" }, owner({ sessionVersion: 1 }))).toBe("ended");
  });
  it("a password session ends with the password: made a player, switched off, or changed", () => {
    const s = { sv: 0, via: "password" as const, pa: 5000 };
    expect(sessionProblem(s, owner())).toBeNull();
    expect(sessionProblem(s, owner({ role: "PLAYER" }))).toBeTruthy();
    expect(sessionProblem(s, owner({ adminLogin: null }))).toBeTruthy();
    expect(sessionProblem(s, owner({ adminLogin: { enabled: true, passwordAt: new Date(6000) } }))).toBeTruthy();
    expect(sessionProblem({ sv: 0, via: "discord" }, owner({ adminLogin: null }))).toBeNull();
  });
  it("password and link sessions last 12 hours", () => {
    expect(SHORT_SESSION_MS).toBe(12 * 3600_000);
    expect(tokenExpired({ until: 1000 }, 999)).toBe(false);
    expect(tokenExpired({ until: 1000 }, 1000)).toBe(true);
    expect(tokenExpired({}, Date.now())).toBe(false);
  });
});

describe("the event log", () => {
  const actor = { role: "ADMIN" as const, name: "Alex" };
  const none = { role: null, name: null };
  it("says who, how, from where", () => {
    expect(describeAction("auth.adminPassword", actor, { via: "code", ip: "1.2.3.4", country: "DE" })).toBe("Alex signed in with password + code from 1.2.3.4 (DE)");
    expect(describeAction("auth.adminPassword", actor, { via: "recovery", recoveryLeft: 9, ip: "1.2.3.4", country: null })).toBe("Alex signed in with password + a recovery code (9 left) from 1.2.3.4");
    expect(describeAction("auth.adminPasswordFailed", none, { username: "alex", ip: "1.2.3.4", country: "DE" }, "DENIED")).toBe("Failed admin sign-in for 'alex' from 1.2.3.4 (DE)");
    expect(describeAction("auth.adminPasswordFailed", none, { username: "alex", ip: "1.2.3.4", country: "DE", lockedNow: true }, "DENIED")).toBe("Failed admin sign-in for 'alex' from 1.2.3.4 (DE); locked for 15 minutes");
    expect(describeAction("auth.adminPasswordFailed", none, { username: "alex", ip: "1.2.3.4", locked: true }, "DENIED")).toBe("Refused admin sign-in (locked) for 'alex' from 1.2.3.4");
    expect(describeAction("auth.adminOff", actor, { forName: "Rowan" })).toBe("Alex turned password sign-in off for Rowan");
    expect(kindOf("auth.adminPasswordFailed", null)).toBe("ADMIN_ACTION");
  });
  it("the break-glass CLI writes the same line the site would", () => {
    const script = readFileSync(new URL("../../api/scripts/reset-auth.mjs", import.meta.url), "utf8");
    expect(script).toContain("`One-time sign-in link made from the command line for ${user.displayName}${totpReset ? \" (authenticator switched off)\" : \"\"}, valid 15 minutes`");
    expect(describeAction("auth.adminBreakGlass", none, { displayName: "Alex", totpReset: true })).toBe("One-time sign-in link made from the command line for Alex (authenticator switched off), valid 15 minutes");
  });
});
