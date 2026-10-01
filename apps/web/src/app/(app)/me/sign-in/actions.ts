"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { audit } from "@/server/events";
import { confirmOwnCode, hashAdminPassword, newRecoveryCodes, openSecret, removeAdminLogin, sealSecret, verifyAdminPassword } from "@/server/auth/admin-login";
import { normaliseUsername, passwordProblem, USERNAME_RE } from "@/server/auth/password-policy";
import { newTotpSecret, verifyTotp } from "@/server/auth/totp";

// Admin password sign-in (planner, 2026-10-01): set up and look after one's own. Nobody sets or sees another admin's
// password; another admin can only turn it off (Admin → People).

export type FormState = { ok?: string; error?: string; codes?: string[] };

const PATH = "/me/sign-in";
const BAD_CODE = "That code didn't match. Use the 6-digit code your authenticator app shows now.";
const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function startSetup(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  const row = await db.adminLogin.findUnique({ where: { userId: me.id } });
  if (row?.enabled) return { error: "Password sign-in is already on." };
  const username = normaliseUsername(fd.get("username"));
  const password = String(fd.get("password") ?? "");
  if (!USERNAME_RE.test(username)) return { error: "Username: 3 to 32 characters, lower-case letters, digits, dot, dash or underscore." };
  const taken = await db.adminLogin.findFirst({ where: { username, NOT: { userId: me.id } }, select: { userId: true } });
  if (taken) return { error: "That username is taken." };
  if (password !== String(fd.get("confirm") ?? "")) return { error: "The two passwords are not the same." };
  const problem = passwordProblem(password, username);
  if (problem) return { error: problem };
  const data = { username, passwordHash: await hashAdminPassword(password), passwordAt: new Date(), enabled: false, totpSecret: null, pendingSecret: sealSecret(newTotpSecret()), lastStep: null, recovery: json([]) };
  await db.adminLogin.upsert({ where: { userId: me.id }, create: { userId: me.id, ...data }, update: data });
  revalidatePath(PATH);
  return { ok: "Now add it to your authenticator app." };
}

export async function confirmSetup(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  const row = await db.adminLogin.findUnique({ where: { userId: me.id } });
  const pending = openSecret(row?.pendingSecret ?? null);
  if (!row || row.enabled || !pending) return { error: "Start again from the top." };
  const step = verifyTotp(pending, String(fd.get("code") ?? "").trim(), Date.now());
  if (step === null) return { error: BAD_CODE };
  const { codes, entries } = newRecoveryCodes();
  await db.adminLogin.update({ where: { userId: me.id }, data: { totpSecret: row.pendingSecret, pendingSecret: null, enabled: true, enabledAt: new Date(), lastStep: step, recovery: json(entries) } });
  await audit({ userId: me.id, action: "auth.adminSetup", params: { username: row.username }, result: "OK" });
  revalidatePath(PATH);
  return { ok: "Password sign-in is on.", codes };
}

export async function cancelSetup(): Promise<void> {
  const me = await requireAdmin();
  await db.adminLogin.deleteMany({ where: { userId: me.id, enabled: false } });
  revalidatePath(PATH);
}

export async function changePassword(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  const row = await db.adminLogin.findUnique({ where: { userId: me.id } });
  if (!row?.enabled) return { error: "Password sign-in is not on." };
  const password = String(fd.get("password") ?? "");
  if (!(await verifyAdminPassword(row.passwordHash, String(fd.get("current") ?? "")))) return { error: "The current password is not right." };
  if (password !== String(fd.get("confirm") ?? "")) return { error: "The two new passwords are not the same." };
  const problem = passwordProblem(password, row.username);
  if (problem) return { error: problem };
  if (!(await confirmOwnCode(me.id, String(fd.get("code") ?? "")))) return { error: BAD_CODE };
  await db.adminLogin.update({ where: { userId: me.id }, data: { passwordHash: await hashAdminPassword(password), passwordAt: new Date() } });
  await audit({ userId: me.id, action: "auth.adminPasswordChange", params: { username: row.username }, result: "OK" });
  // Every session that came in with the old password has ended, this one too if it did.
  if (me.via === "password") redirect("/login/admin?changed=1");
  revalidatePath(PATH);
  return { ok: "Password changed. Sessions that signed in with the old one have ended." };
}

export async function startTotpReset(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  if (!(await confirmOwnCode(me.id, String(fd.get("code") ?? "")))) return { error: BAD_CODE };
  await db.adminLogin.update({ where: { userId: me.id }, data: { pendingSecret: sealSecret(newTotpSecret()) } });
  revalidatePath(PATH);
  return { ok: "Add the new one to your authenticator app, then confirm it below." };
}

export async function confirmTotpReset(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  const row = await db.adminLogin.findUnique({ where: { userId: me.id } });
  const pending = openSecret(row?.pendingSecret ?? null);
  if (!row?.enabled || !pending) return { error: "Start again." };
  const step = verifyTotp(pending, String(fd.get("code") ?? "").trim(), Date.now());
  if (step === null) return { error: BAD_CODE };
  await db.adminLogin.update({ where: { userId: me.id }, data: { totpSecret: row.pendingSecret, pendingSecret: null, lastStep: step } });
  await audit({ userId: me.id, action: "auth.adminTotpReset", params: { username: row.username }, result: "OK" });
  revalidatePath(PATH);
  return { ok: "The new authenticator is in use; the old one no longer works." };
}

export async function cancelTotpReset(): Promise<void> {
  const me = await requireAdmin();
  await db.adminLogin.updateMany({ where: { userId: me.id }, data: { pendingSecret: null } });
  revalidatePath(PATH);
}

export async function regenerateRecovery(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  if (!(await confirmOwnCode(me.id, String(fd.get("code") ?? "")))) return { error: BAD_CODE };
  const { codes, entries } = newRecoveryCodes();
  await db.adminLogin.update({ where: { userId: me.id }, data: { recovery: json(entries) } });
  await audit({ userId: me.id, action: "auth.adminRecovery", params: {}, result: "OK" });
  revalidatePath(PATH);
  return { ok: "New recovery codes. The old ones no longer work.", codes };
}

export async function turnOffOwn(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  if (!(await confirmOwnCode(me.id, String(fd.get("code") ?? "")))) return { error: BAD_CODE };
  await removeAdminLogin(me.id);
  await audit({ userId: me.id, action: "auth.adminOff", params: {}, result: "OK" });
  if (me.via === "password" || me.via === "link") redirect("/login");
  revalidatePath(PATH);
  return { ok: "Password sign-in is off." };
}
