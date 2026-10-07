// Edge-safe part of the Auth.js config: used by middleware. No database, no bcrypt.
import type { NextAuthConfig } from "next-auth";
import Discord from "next-auth/providers/discord";
import type { Role } from "@prisma/client";
import type { SignInVia } from "@/next-auth";
import { env } from "@/env";

export type AppToken = { uid?: string; role?: Role; sv?: number; via?: SignInVia; until?: number; pa?: number };

/** Admin password (and break-glass link) sessions last 12 hours, not 30 days (planner, 2026-10-01). */
export const SHORT_SESSION_MS = 12 * 60 * 60 * 1000;

/** A session past its own end: checked wherever the token is read, the middleware included (no database there). */
export const tokenExpired = (t: AppToken, now: number = Date.now()) => typeof t.until === "number" && now >= t.until;

const secure = env.secureCookies;

export const authConfig = {
  trustHost: true,
  providers: env.discordEnabled
    ? [
        Discord({
          clientId: env.DISCORD_CLIENT_ID,
          clientSecret: env.DISCORD_CLIENT_SECRET,
          issuer: "https://discord.com", // the iss Discord sends on its callback; the endpoints stay explicit, so no discovery
          authorization: { params: { scope: env.DISCORD_GUILD_ID ? "identify guilds" : "identify" } },
        }),
      ]
    : [],
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  ...(env.COOKIE_DOMAIN
    ? {
        cookies: {
          sessionToken: {
            name: `${secure ? "__Secure-" : ""}authjs.session-token`,
            options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure, domain: env.COOKIE_DOMAIN },
          },
        },
      }
    : {}),
  callbacks: {
    jwt({ token }) {
      return tokenExpired(token as AppToken) ? null : token;
    },
    session({ session, token }) {
      const t = token as AppToken;
      if (t.uid) session.user.id = t.uid;
      if (t.role) session.user.role = t.role;
      session.user.sv = t.sv ?? 0;
      if (t.via) session.user.via = t.via;
      if (t.pa) session.user.pa = t.pa;
      return session;
    },
  },
} satisfies NextAuthConfig;
