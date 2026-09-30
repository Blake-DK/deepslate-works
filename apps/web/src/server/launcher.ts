import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/server/db";
import { generateInviteCode } from "@/server/auth/invite-codes";

// Device-style sign-in for the Windows installer/updater (docs/07).
export const APPROVAL_WINDOW_MS = 10 * 60_000;
export const TOKEN_LIFETIME_MS = 7 * 86_400_000;

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function startLauncherAuth(hostname: string | null) {
  for (let i = 0; i < 5; i++) {
    const code = generateInviteCode();
    if (await db.launcherAuth.findUnique({ where: { code } })) continue;
    const pollToken = randomBytes(24).toString("base64url");
    await db.launcherAuth.create({ data: { code, pollToken, hostname: hostname?.slice(0, 64) ?? null, expiresAt: new Date(Date.now() + APPROVAL_WINDOW_MS) } });
    return { code, pollToken };
  }
  throw new Error("could not allocate a code");
}

export async function pollLauncherAuth(pollToken: string): Promise<{ status: "pending" | "approved" | "denied" | "expired"; launcherToken?: string; displayName?: string }> {
  const row = await db.launcherAuth.findUnique({ where: { pollToken }, include: { user: { select: { displayName: true } } } });
  if (!row) return { status: "expired" };
  if (row.status === "pending" && row.expiresAt.getTime() < Date.now()) {
    await db.launcherAuth.update({ where: { code: row.code }, data: { status: "expired" } });
    return { status: "expired" };
  }
  if (row.status !== "approved" || !row.userId) return { status: row.status as "pending" | "denied" | "expired" };
  if (row.tokenHash) return { status: "approved" }; // token already handed out once; the script keeps it
  const token = randomBytes(32).toString("base64url");
  await db.launcherAuth.update({ where: { code: row.code }, data: { tokenHash: hash(token), expiresAt: new Date(Date.now() + TOKEN_LIFETIME_MS), pollToken: `used:${row.code}:${randomBytes(8).toString("hex")}` } });
  return { status: "approved", launcherToken: token, displayName: row.user?.displayName };
}

/** Called from the approval page by a logged-in user. */
export async function approveLauncherAuth(code: string, userId: string, approve: boolean): Promise<"ok" | "denied" | "gone"> {
  const row = await db.launcherAuth.findUnique({ where: { code } });
  if (!row || row.status !== "pending" || row.expiresAt.getTime() < Date.now()) return "gone";
  await db.launcherAuth.update({ where: { code }, data: approve ? { status: "approved", userId, approvedAt: new Date() } : { status: "denied" } });
  return approve ? "ok" : "denied";
}

/** Resolves a launcher token (Authorization: Bearer …) to its user, or null. */
export async function userFromLauncherToken(token: string | null) {
  if (!token || token.length < 20) return null;
  const row = await db.launcherAuth.findUnique({ where: { tokenHash: hash(token) }, include: { user: true } });
  if (!row || row.status !== "approved" || !row.user || row.expiresAt.getTime() < Date.now()) return null;
  void db.launcherAuth.update({ where: { code: row.code }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return row.user;
}

export async function revokeLauncherTokens(userId: string): Promise<number> {
  const r = await db.launcherAuth.updateMany({ where: { userId, status: "approved" }, data: { status: "denied" } });
  return r.count;
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : null;
}
