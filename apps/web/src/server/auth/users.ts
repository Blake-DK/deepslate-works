import "server-only";
import type { Role } from "@prisma/client";
import { db } from "@/server/db";
import { env } from "@/env";
import { consumeInvite } from "./invites";

type NewUser = {
  displayName: string;
  discordId?: string;
  email?: string;
  passwordHash?: string;
  inviteCode?: string; // omitted only for the ADMIN_DISCORD_ID bootstrap
  invitedById?: string | null;
};

/**
 * Creates a user, consuming the invite in the same transaction.
 * The very first user, or the configured admin Discord id, becomes ADMIN.
 */
export async function createUser(input: NewUser) {
  return db.$transaction(async (tx) => {
    const count = await tx.user.count();
    const bootstrapAdmin = Boolean(env.ADMIN_DISCORD_ID) && input.discordId === env.ADMIN_DISCORD_ID;
    const role: Role = count === 0 || bootstrapAdmin ? "ADMIN" : "PLAYER";
    const user = await tx.user.create({
      data: {
        displayName: input.displayName.slice(0, 64),
        discordId: input.discordId,
        email: input.email?.toLowerCase(),
        passwordHash: input.passwordHash,
        role,
        invitedById: input.invitedById ?? null,
        lastSeenAt: new Date(),
      },
    });
    if (input.inviteCode) await consumeInvite(tx, input.inviteCode, user.id);
    await tx.auditLog.create({
      data: { userId: user.id, action: "auth.register", params: { via: input.discordId ? "discord" : "email", role }, result: "OK" },
    });
    return user;
  });
}

export async function touchLastSeen(userId: string) {
  await db.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }).catch(() => {});
}
