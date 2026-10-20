import "server-only";
import type { Role } from "@prisma/client";
import { db } from "@/server/db";
import { env } from "@/env";
import { consumeInvite } from "./invites";
import { audit } from "@/server/events";

type NewUser = {
  displayName: string;
  discordId?: string;
  authentikSub?: string; // docs/04: signed in through Authentik
  admin?: boolean; // Authentik's group deepslate-admins said so (server/auth/sso-core.ts)
  email?: string;
  passwordHash?: string;
  inviteCode?: string; // omitted only for the ADMIN_DISCORD_ID bootstrap and for being in the Discord server (auto-join)
  invitedById?: string | null;
  outsideAuth?: boolean; // an invite brought them: the Discord server rule is not applied
  guildMember?: boolean; // what Discord said at this sign-in, when the rule is on
};

/**
 * Creates a user, consuming the invite in the same transaction.
 * The very first user, or the configured admin Discord id, becomes ADMIN; so does one Authentik says is an admin.
 */
export async function createUser(input: NewUser) {
  return db.$transaction(async (tx) => {
    const count = await tx.user.count();
    const bootstrapAdmin = Boolean(env.ADMIN_DISCORD_ID) && input.discordId === env.ADMIN_DISCORD_ID;
    const role: Role = count === 0 || bootstrapAdmin || input.admin ? "ADMIN" : "PLAYER";
    const user = await tx.user.create({
      data: {
        displayName: input.displayName.slice(0, 64),
        discordId: input.discordId,
        authentikSub: input.authentikSub,
        email: input.email?.toLowerCase(),
        passwordHash: input.passwordHash,
        role,
        // Alex, 2026-10-14: an admin can join during the site's Maintenance from the start (docs/48 B1's tick)
        maintenanceJoin: role === "ADMIN",
        invitedById: input.invitedById ?? null,
        outsideAuth: input.outsideAuth ?? false,
        guildMember: input.guildMember,
        lastSeenAt: new Date(),
      },
    });
    if (input.inviteCode) await consumeInvite(tx, input.inviteCode, user.id);
    await audit({ userId: user.id, action: "auth.register", params: { via: input.authentikSub ? "authentik" : input.discordId ? "discord" : "email", role }, result: "OK" }, tx);
    return user;
  });
}

export async function touchLastSeen(userId: string) {
  await db.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }).catch(() => {});
}
