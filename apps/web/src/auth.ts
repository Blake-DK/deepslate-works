import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { cookies } from "next/headers";
import { z } from "zod";
import { authConfig, type AppToken } from "@/auth.config";
import { db } from "@/server/db";
import { env } from "@/env";
import { verifyPassword } from "@/server/auth/password";
import { findValidInvite } from "@/server/auth/invites";
import { createUser, touchLastSeen } from "@/server/auth/users";
import { loginLimiter } from "@/server/auth/rate-limit";
import { clientIp } from "@/server/auth/request";
import { INVITE_COOKIE } from "@/server/auth/constants";

class RateLimited extends CredentialsSignin {
  code = "rate_limited";
}

const credentialsSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase();
        const ip = await clientIp();
        if (!loginLimiter.allow(ip)) {
          await db.auditLog.create({ data: { action: "auth.login", params: { email, ip }, result: "DENIED", detail: "rate limited" } });
          throw new RateLimited();
        }
        const user = await db.user.findUnique({ where: { email } });
        const ok = Boolean(user?.passwordHash) && (await verifyPassword(parsed.data.password, user!.passwordHash!));
        if (!user || !ok) {
          await db.auditLog.create({ data: { action: "auth.login", params: { email, ip }, result: "DENIED", detail: "bad credentials" } });
          return null;
        }
        await touchLastSeen(user.id);
        return { id: user.id, name: user.displayName };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (account?.provider !== "discord") return true;
      const discordId = account.providerAccountId;
      const existing = await db.user.findUnique({ where: { discordId } });
      if (existing) {
        await touchLastSeen(existing.id);
        return true;
      }
      const bootstrapAdmin = Boolean(env.ADMIN_DISCORD_ID) && discordId === env.ADMIN_DISCORD_ID;
      const jar = await cookies();
      const inviteCode = jar.get(INVITE_COOKIE)?.value;
      const invite = inviteCode ? await findValidInvite(inviteCode) : null;
      if (!bootstrapAdmin && !invite) {
        await db.auditLog.create({ data: { action: "auth.login", params: { discordId, via: "discord" }, result: "DENIED", detail: "no invite" } });
        return "/login?error=no-invite";
      }
      const p = (profile ?? {}) as { global_name?: string | null; username?: string };
      await createUser({
        displayName: user.name ?? p.global_name ?? p.username ?? "Player",
        discordId,
        inviteCode: invite?.code,
        invitedById: invite?.createdBy,
      });
      try {
        jar.delete(INVITE_COOKIE);
      } catch {
        /* not writable in this context; the cookie expires on its own */
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (user) {
        const dbUser =
          account?.provider === "discord"
            ? await db.user.findUnique({ where: { discordId: account.providerAccountId } })
            : await db.user.findUnique({ where: { id: user.id! } });
        if (!dbUser) return null;
        const t = token as AppToken;
        t.uid = dbUser.id;
        t.role = dbUser.role;
      }
      return token;
    },
  },
});
