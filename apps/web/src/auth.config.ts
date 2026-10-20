// Edge-safe part of the Auth.js config: used by middleware. No database, no bcrypt.
import type { NextAuthConfig } from "next-auth";
import Discord from "next-auth/providers/discord";
import type { OIDCConfig } from "next-auth/providers";
import type { Role } from "@prisma/client";
import type { SignInVia } from "@/next-auth";
import { env } from "@/env";

export type AppToken = { uid?: string; role?: Role; sv?: number; via?: SignInVia; until?: number; pa?: number };

/** Admin password (and break-glass link) sessions last 12 hours, not 30 days (planner, 2026-10-01). */
export const SHORT_SESSION_MS = 12 * 60 * 60 * 1000;

/** A session past its own end: checked wherever the token is read, the middleware included (no database there). */
export const tokenExpired = (t: AppToken, now: number = Date.now()) => typeof t.until === "number" && now >= t.until;

const secure = env.secureCookies;

/**
 * docs/42 T2: the test site's session cookie has a name of its own and belongs to its own host. The live site's cookie
 * is set for the parent domain, so the browser sends it to the test host too; under its own name the test site never
 * reads it (and Caddy strips it before the request gets there). Unset TEST_MODE: the cookies are as they always were.
 */
export function sessionCookie(o: { testMode: boolean; secure: boolean; cookieDomain?: string }) {
  if (o.testMode) return { sessionToken: { name: `${o.secure ? "__Secure-" : ""}dswtest.session-token`, options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure: o.secure } } };
  if (o.cookieDomain) return { sessionToken: { name: `${o.secure ? "__Secure-" : ""}authjs.session-token`, options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure: o.secure, domain: o.cookieDomain } } };
  return null;
}
const cookies = sessionCookie({ testMode: env.TEST_MODE, secure, cookieDomain: env.COOKIE_DOMAIN });

/** The id `authentik` is in the redirect URIs Authentik holds: <AUTH_URL>/api/auth/callback/authentik. */
export const SSO_PROVIDER = "authentik";

/**
 * docs/04: sign-in through Authentik, where the member picks Discord or Microsoft. Authorization code with PKCE (S256),
 * state and nonce. The id token comes straight from Authentik's token endpoint over TLS (client secret and PKCE
 * verifier); its issuer, audience and nonce are checked. Scopes: `openid`, `profile` (a
 * name only: Authentik's mapping for this provider leaves the groups out) and `deepslate` (`discord_id`,
 * `deepslate_roles`, server/auth/sso-core.ts). No email.
 */
export function ssoProvider(e: { AUTHENTIK_ISSUER: string; AUTHENTIK_CLIENT_ID: string; AUTHENTIK_CLIENT_SECRET: string }): OIDCConfig<Record<string, unknown>> {
  return {
    id: SSO_PROVIDER,
    name: "Discord or Microsoft",
    type: "oidc",
    issuer: e.AUTHENTIK_ISSUER,
    clientId: e.AUTHENTIK_CLIENT_ID,
    clientSecret: e.AUTHENTIK_CLIENT_SECRET,
    checks: ["pkce", "state", "nonce"],
    authorization: { params: { scope: "openid profile deepslate" } },
    profile(p) {
      const name = [p.name, p.preferred_username].find((v): v is string => typeof v === "string" && v.trim() !== "");
      return { id: String(p.sub), name: name ?? null };
    },
  };
}

export const authConfig = {
  trustHost: true,
  providers: [
    ...(env.ssoEnabled ? [ssoProvider(env)] : []),
    ...(env.discordLogin
      ? [
          Discord({
            clientId: env.DISCORD_CLIENT_ID,
            clientSecret: env.DISCORD_CLIENT_SECRET,
            issuer: "https://discord.com", // the iss Discord sends on its callback; the endpoints stay explicit, so no discovery
            authorization: { params: { scope: env.DISCORD_GUILD_ID ? "identify guilds" : "identify" } },
          }),
        ]
      : []),
  ],
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  ...(cookies ? { cookies } : {}),
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
