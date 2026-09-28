import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { generateInviteCode, inviteState, normaliseInviteCode } from "./invite-codes";

export async function findValidInvite(rawCode: string) {
  const code = normaliseInviteCode(rawCode);
  if (!code) return null;
  const invite = await db.invite.findUnique({ where: { code } });
  return inviteState(invite) === "valid" ? invite : null;
}

export async function createInvite(createdBy: string, note: string | null, days: number) {
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode();
    const exists = await db.invite.findUnique({ where: { code } });
    if (!exists) return db.invite.create({ data: { code, createdBy, note, expiresAt } });
  }
  throw new Error("Could not generate a unique invite code");
}

/** Marks the invite used inside a transaction. Throws if it was consumed in the meantime. */
export async function consumeInvite(tx: Prisma.TransactionClient, code: string, userId: string) {
  const res = await tx.invite.updateMany({
    where: { code, usedBy: null, expiresAt: { gt: new Date() } },
    data: { usedBy: userId },
  });
  if (res.count !== 1) throw new Error("Invite is no longer valid");
}
