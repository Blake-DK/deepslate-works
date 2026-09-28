// Edge-safe part of the Auth.js config: used by middleware. No database, no bcrypt.
import type { NextAuthConfig } from "next-auth";
import Discord from "next-auth/providers/discord";
import type { Role } from "@prisma/client";
import { env } from "@/env";

export type AppToken = { uid?: string; role?: Role };

const secure = env.secureCookies;

export const authConfig = {
  trustHost: true,
  providers: env.discordEnabled
    ? [
        Discord({
          clientId: env.DISCORD_CLIENT_ID,
          clientSecret: env.DISCORD_CLIENT_SECRET,
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
    session({ session, token }) {
      const t = token as AppToken;
      if (t.uid) session.user.id = t.uid;
      if (t.role) session.user.role = t.role;
      return session;
    },
  },
} satisfies NextAuthConfig;
