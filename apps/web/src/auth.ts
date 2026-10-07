import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { cookies } from "next/headers";
import { z } from "zod";
import { createHash } from "node:crypto";
import { authConfig, SHORT_SESSION_MS, tokenExpired, type AppToken } from "@/auth.config";
import { db } from "@/server/db";
import { env } from "@/env";
import { dummyVerifyPassword, verifyPassword } from "@/server/auth/password";
import { consumeInvite, findValidInvite } from "@/server/auth/invites";
import { discordDoor } from "@/server/auth/discord-door";
import { createUser, touchLastSeen } from "@/server/auth/users";
import { isBlocked } from "@/server/auth/blocked";
import { loginLimiter } from "@/server/auth/rate-limit";
import { clientIp } from "@/server/auth/request";
import { INVITE_COOKIE } from "@/server/auth/constants";
import { audit } from "@/server/events";
import { checkAdminSignIn } from "@/server/auth/admin-core";
import { auditSignIn, countryOf, signInDeps } from "@/server/auth/admin-login";
import { adminLockouts } from "@/server/auth/lockout";
import { logAuthError, reportSignIn } from "@/server/auth/signin-report";

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

/**
 * Discord `guilds` scope: list the user's servers and look for ours. Three answers (docs/35 R-12): true, false, and
 * null when Discord did not say (no token, 429, 5xx, timeout). Null is never read as "left the server".
 */
async function isGuildMember(accessToken: string | undefined, guildId: string): Promise<boolean | null> {
  if (!accessToken) return null;
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const guilds = (await res.json()) as unknown;
    if (!Array.isArray(guilds)) return null;
    return (guilds as Array<{ id?: string }>).some((g) => g?.id === guildId);
  } catch {
    return null;
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
        const hash = user?.passwordHash;
        const ok = hash ? await verifyPassword(parsed.data.password, hash) : false;
        if (!hash) await dummyVerifyPassword(parsed.data.password);
        if (!user || !ok) {
          await audit({ action: "auth.login", params: { email, ip }, result: "DENIED", detail: "bad credentials" });
          return null;
        }
        // docs/31 B-35: an admin never signs in by email and password alone (docs/04: "no password-only path").
        // An email-fallback member who was made admin uses Discord, or the admin sign-in with its code.
        if (user.role === "ADMIN") {
          await audit({ userId: user.id, action: "auth.login", params: { email, ip }, result: "DENIED", detail: "admin by email and password" });
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
  // sign-in failures raise an alert in the admin channel (server/auth/signin-report.ts): outcomes only
  logger: { error: logAuthError },
  events: { signIn: ({ account }) => reportSignIn(account?.provider, true) },
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (account?.provider !== "discord") return true;
      const discordId = account.providerAccountId;
      // docs/31 B-37: removed and blocked by an admin. Refused before the guild is asked and before any account is made.
      if (await isBlocked(discordId)) {
        await audit({ action: "auth.login", params: { discordId, via: "discord" }, result: "DENIED", detail: "blocked" });
        return "/login?error=blocked";
      }
      // Optional gate: must be a member of Alex's Discord server (checked on every Discord sign-in), unless an
      // invite link brought them: an invite stands in for the server (`discordDoor`).
      const inGuild = env.DISCORD_GUILD_ID ? await isGuildMember(account.access_token, env.DISCORD_GUILD_ID) : false;
      const existing = await db.user.findUnique({ where: { discordId } });
      const jar = await cookies();
      const inviteCode = jar.get(INVITE_COOKIE)?.value;
      const invite = inviteCode ? await findValidInvite(inviteCode) : null;
      const dropInvite = () => {
        try {
          jar.delete(INVITE_COOKIE);
        } catch {
          /* not writable in this context; the cookie expires on its own */
        }
      };
      const bootstrapAdmin = Boolean(env.ADMIN_DISCORD_ID) && discordId === env.ADMIN_DISCORD_ID;
      const decision = discordDoor({ gate: Boolean(env.DISCORD_GUILD_ID), inGuild, existing, invite: Boolean(invite), staleInvite: Boolean(inviteCode) && !invite, autoJoin: env.DISCORD_GUILD_AUTO_JOIN, bootstrapAdmin });
      const leftServer = Boolean(env.DISCORD_GUILD_ID) && inGuild === false;
      const refused = async (why: "not-in-server" | "no-invite" | "invite-invalid", detail: string) => {
        // docs/14 §7: back to the room next join. docs/31 B-05: and every session they still have ends, the
        // installer's tokens with it, so an old cookie cannot link them back in.
        if (leftServer && existing?.guildMember && !existing.outsideAuth) {
          await db.user.update({ where: { id: existing.id }, data: { guildMember: false, sessionVersion: { increment: 1 } } });
          await db.launcherAuth.updateMany({ where: { userId: existing.id, status: "approved" }, data: { status: "denied" } });
        }
        if (why === "invite-invalid") dropInvite();
        await audit({ action: "auth.login", params: { discordId, via: "discord" }, result: "DENIED", detail });
        return `/login?error=${why}`;
      };
      if (decision.door === "refuse") {
        if (decision.why === "discord-unavailable") {
          // docs/35 R-12: Discord gave no answer. This sign-in is refused; nothing about the member changes.
          await audit({ action: "auth.login", params: { discordId, via: "discord" }, result: "DENIED", detail: "discord did not answer" });
          return "/login?error=discord-unavailable";
        }
        const detail = decision.why === "invite-invalid" ? (leftServer ? "not in discord server, invite link not valid" : "invite link not valid") : decision.why === "not-in-server" ? "not in discord server" : "no invite";
        return refused(decision.why, detail);
      }
      if (existing && decision.door === "exempt") {
        // A member who is not in the server, with a new invite: the invite is theirs and the rule no longer applies.
        try {
          await db.$transaction(async (tx) => {
            await consumeInvite(tx, invite!.code, existing.id);
            await tx.user.update({ where: { id: existing.id }, data: { outsideAuth: true } });
            await audit({ userId: existing.id, action: "user.outsideAuth", params: { id: existing.id, displayName: existing.displayName, on: true, invite: invite!.code }, result: "OK" }, tx);
          });
        } catch {
          return refused("invite-invalid", "not in discord server, invite not usable");
        }
        dropInvite();
      }
      if (existing) {
        await touchLastSeen(existing.id);
        // The flag stays what Discord last said, for whoever is on the outside list too: it counts again if they are taken off it.
        if (env.DISCORD_GUILD_ID && inGuild !== null && existing.guildMember !== inGuild) await db.user.update({ where: { id: existing.id }, data: { guildMember: inGuild } });
        return true;
      }
      const outside = decision.door === "create" && decision.outside;
      const p = (profile ?? {}) as { global_name?: string | null; username?: string };
      try {
        await createUser({
          displayName: user.name ?? p.global_name ?? p.username ?? "Player",
          discordId,
          inviteCode: invite?.code,
          invitedById: invite?.createdBy,
          outsideAuth: outside,
          guildMember: env.DISCORD_GUILD_ID ? (inGuild ?? undefined) : undefined,
        });
      } catch (err) {
        // the invite was used by someone else between the look and the write
        if (invite) return refused("invite-invalid", "invite used in the meantime");
        throw err;
      }
      dropInvite();
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
