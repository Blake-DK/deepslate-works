import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { cookies } from "next/headers";
import { z } from "zod";
import { createHash } from "node:crypto";
import { authConfig, SHORT_SESSION_MS, tokenExpired, type AppToken } from "@/auth.config";
import { db } from "@/server/db";
import { env } from "@/env";
import { verifyPassword } from "@/server/auth/password";
import { findValidInvite } from "@/server/auth/invites";
import { createUser, touchLastSeen } from "@/server/auth/users";
import { loginLimiter } from "@/server/auth/rate-limit";
import { clientIp } from "@/server/auth/request";
import { INVITE_COOKIE } from "@/server/auth/constants";
import { audit } from "@/server/events";
import { checkAdminSignIn } from "@/server/auth/admin-core";
import { auditSignIn, countryOf, signInDeps } from "@/server/auth/admin-login";
import { adminLockouts } from "@/server/auth/lockout";

class RateLimited extends CredentialsSignin {
  code = "rate_limited";
}
class AdminLocked extends CredentialsSignin {
  code = "admin_locked";
}
class AdminFailed extends CredentialsSignin {
  code = "admin_failed";
}

const VIA: Record<string, NonNullable<AppToken["via"]>> = { discord: "discord", credentials: "email", "admin-password": "password", "one-time-link": "link" };

/** Discord `guilds` scope: list the user's servers and look for ours. Fails closed. */
async function isGuildMember(accessToken: string | undefined, guildId: string): Promise<boolean> {
  if (!accessToken) return false;
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!res.ok) return false;
    const guilds = (await res.json()) as Array<{ id: string }>;
    return guilds.some((g) => g.id === guildId);
  } catch {
    return false;
  }
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
          await audit({ action: "auth.login", params: { email, ip }, result: "DENIED", detail: "rate limited" });
          throw new RateLimited();
        }
        const user = await db.user.findUnique({ where: { email } });
        const ok = Boolean(user?.passwordHash) && (await verifyPassword(parsed.data.password, user!.passwordHash!));
        if (!user || !ok) {
          await audit({ action: "auth.login", params: { email, ip }, result: "DENIED", detail: "bad credentials" });
          return null;
        }
        await touchLastSeen(user.id);
        return { id: user.id, name: user.displayName };
      },
    }),
    // Admins only (planner, 2026-10-01): username + password + authenticator code (or a recovery code), all three.
    Credentials({
      id: "admin-password",
      name: "Admin password",
      credentials: { username: {}, password: {}, code: {} },
      async authorize(raw) {
        const ip = await clientIp();
        const out = await checkAdminSignIn({ username: raw?.username, password: raw?.password, code: raw?.code, ip }, signInDeps, adminLockouts);
        await auditSignIn(out, ip);
        if (!out.ok) throw out.why === "locked" ? new AdminLocked() : new AdminFailed();
        await touchLastSeen(out.userId);
        return { id: out.userId, name: out.displayName };
      },
    }),
    // Break-glass (docs/09): a link made by `pnpm admin:reset-auth` in the api container. Once, within 15 minutes.
    Credentials({
      id: "one-time-link",
      name: "One-time link",
      credentials: { token: {} },
      async authorize(raw) {
        const token = String(raw?.token ?? "");
        const ip = await clientIp();
        if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) throw new AdminFailed();
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const used = await db.oneTimeLogin.updateMany({ where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
        const row = used.count === 1 ? await db.oneTimeLogin.findUnique({ where: { tokenHash }, include: { user: { select: { id: true, displayName: true, role: true } } } }) : null;
        if (!row || row.user.role !== "ADMIN") {
          await audit({ action: "auth.adminLinkFailed", params: { ip, country: await countryOf(ip) }, result: "DENIED", detail: row ? "not an admin" : "unknown, used or expired" });
          throw new AdminFailed();
        }
        await audit({ userId: row.user.id, action: "auth.adminLink", params: { ip, country: await countryOf(ip) }, result: "OK" });
        await touchLastSeen(row.user.id);
        return { id: row.user.id, name: row.user.displayName };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (account?.provider !== "discord") return true;
      const discordId = account.providerAccountId;
      // Optional gate: must be a member of Alex's Discord server (checked on every Discord sign-in).
      let inGuild = false;
      if (env.DISCORD_GUILD_ID) {
        inGuild = await isGuildMember(account.access_token, env.DISCORD_GUILD_ID);
        if (!inGuild) {
          await db.user.updateMany({ where: { discordId }, data: { guildMember: false } }); // docs/14 §7: back to the room next join
          await audit({ action: "auth.login", params: { discordId, via: "discord" }, result: "DENIED", detail: "not in discord server" });
          return "/login?error=not-in-server";
        }
      }
      const existing = await db.user.findUnique({ where: { discordId } });
      if (existing) {
        await touchLastSeen(existing.id);
        if (env.DISCORD_GUILD_ID && !existing.guildMember) await db.user.update({ where: { id: existing.id }, data: { guildMember: true } });
        return true;
      }
      const bootstrapAdmin = Boolean(env.ADMIN_DISCORD_ID) && discordId === env.ADMIN_DISCORD_ID;
      const jar = await cookies();
      const inviteCode = jar.get(INVITE_COOKIE)?.value;
      const invite = inviteCode ? await findValidInvite(inviteCode) : null;
      const guildIsInvite = inGuild && env.DISCORD_GUILD_AUTO_JOIN;
      if (!bootstrapAdmin && !invite && !guildIsInvite) {
        await audit({ action: "auth.login", params: { discordId, via: "discord" }, result: "DENIED", detail: "no invite" });
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
      if (tokenExpired(token as AppToken)) return null;
      if (user) {
        const include = { adminLogin: { select: { passwordAt: true } } } as const;
        const dbUser =
          account?.provider === "discord"
            ? await db.user.findUnique({ where: { discordId: account.providerAccountId }, include })
            : await db.user.findUnique({ where: { id: user.id! }, include });
        if (!dbUser) return null;
        const t = token as AppToken;
        t.uid = dbUser.id;
        t.role = dbUser.role;
        t.sv = dbUser.sessionVersion;
        t.via = VIA[account?.provider ?? ""] ?? "email";
        if (t.via === "password" || t.via === "link") t.until = Date.now() + SHORT_SESSION_MS;
        if (t.via === "password") t.pa = dbUser.adminLogin?.passwordAt.getTime();
      }
      return token;
    },
  },
});
