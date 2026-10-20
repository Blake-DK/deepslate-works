"use server";
import { AuthError } from "next-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn } from "@/auth";
import { SSO_PROVIDER } from "@/auth.config";
import { env } from "@/env";
import { findValidInvite } from "@/server/auth/invites";
import { createUser } from "@/server/auth/users";
import { hashPassword } from "@/server/auth/password";
import { INVITE_COOKIE, INVITE_COOKIE_MAX_AGE, MIN_PASSWORD_LENGTH } from "@/server/auth/constants";
import { inviteLimiter } from "@/server/auth/rate-limit";
import { clientIp } from "@/server/auth/request";
import { db } from "@/server/db";

/** The invite goes into a short-lived cookie that the sign-in reads (auth.ts, server/auth/sso.ts), then off to sign in. */
async function holdInvite(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  const invite = await findValidInvite(code);
  if (!invite) redirect(`/join/${encodeURIComponent(code)}`);
  const jar = await cookies();
  jar.set(INVITE_COOKIE, invite.code, {
    httpOnly: true, sameSite: "lax", secure: env.secureCookies, path: "/", maxAge: INVITE_COOKIE_MAX_AGE,
  });
  return invite;
}

/** docs/04: through Authentik, with Discord or Microsoft. */
export async function joinWithSso(formData: FormData) {
  if (!env.ssoEnabled) redirect(`/join/${encodeURIComponent(String(formData.get("code") ?? ""))}`);
  await holdInvite(formData);
  await signIn(SSO_PROVIDER, { redirectTo: "/onboarding" });
}

export async function joinWithDiscord(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  if (!env.discordLogin) redirect(env.ssoEnabled ? `/join/${encodeURIComponent(code)}` : `/join/${encodeURIComponent(code)}/email?error=discord-off`);
  await holdInvite(formData);
  await signIn("discord", { redirectTo: "/onboarding" });
}

const registerSchema = z.object({
  code: z.string().min(1),
  displayName: z.string().trim().min(2, "name").max(32, "name"),
  email: z.string().trim().email("email").max(120, "email"),
  password: z.string().min(MIN_PASSWORD_LENGTH, "password").max(200, "password"),
});

export async function registerWithEmail(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  if (env.ssoEnabled) redirect(`/join/${encodeURIComponent(code)}`); // gone with Authentik (docs/04)
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  const back = (err: string): never => redirect(`/join/${encodeURIComponent(code)}/email?error=${err}`);
  if (!parsed.success) return back(parsed.error.issues[0]?.message ?? "form");
  const input = parsed.data;
  if (!inviteLimiter.allow(await clientIp())) return back("rate-limited");
  const invite = await findValidInvite(input.code);
  if (!invite) redirect(`/join/${encodeURIComponent(code)}`);
  const email = input.email.toLowerCase();
  if (await db.user.findUnique({ where: { email } })) return back("email-taken");
  try {
    await createUser({
      displayName: input.displayName,
      email,
      passwordHash: await hashPassword(input.password),
      inviteCode: invite.code,
      invitedById: invite.createdBy,
      outsideAuth: true,
    });
  } catch {
    return back("invite-gone");
  }
  try {
    await signIn("credentials", { email, password: input.password, redirectTo: "/onboarding" });
  } catch (e) {
    if (e instanceof AuthError) redirect("/login?error=credentials");
    throw e;
  }
}
