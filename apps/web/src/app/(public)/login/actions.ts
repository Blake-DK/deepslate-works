"use server";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { SSO_PROVIDER } from "@/auth.config";
import { env } from "@/env";
import { safeNext } from "@/server/auth/next-url";

/** docs/04: sign-in through Authentik, where the member picks Discord or Microsoft. */
export async function ssoLogin(formData: FormData) {
  if (!env.ssoEnabled) redirect("/login?error=sso-off");
  await signIn(SSO_PROVIDER, { redirectTo: safeNext(formData.get("next")) });
}

export async function discordLogin(formData: FormData) {
  if (!env.discordLogin) redirect("/login?error=discord-off");
  await signIn("discord", { redirectTo: safeNext(formData.get("next")) });
}

export async function emailLogin(formData: FormData) {
  const next = safeNext(formData.get("next"));
  if (env.ssoEnabled) redirect(`/login?next=${encodeURIComponent(next)}`); // gone with Authentik (docs/04)
  try {
    await signIn("credentials", { email: formData.get("email"), password: formData.get("password"), redirectTo: next });
  } catch (e) {
    if (e instanceof AuthError) {
      const code = e.type === "CredentialsSignin" && "code" in e && e.code === "rate_limited" ? "rate-limited" : "credentials";
      redirect(`/login?error=${code}&next=${encodeURIComponent(next)}`);
    }
    throw e;
  }
}

/** Admin password sign-in (planner, 2026-10-01). Every failure but a lock gets the same answer. */
export async function adminLogin(formData: FormData) {
  const next = safeNext(formData.get("next"));
  try {
    await signIn("admin-password", { username: formData.get("username"), password: formData.get("password"), code: formData.get("code"), redirectTo: next });
  } catch (e) {
    if (e instanceof AuthError) {
      const locked = e.type === "CredentialsSignin" && "code" in e && e.code === "admin_locked";
      redirect(`/login/admin?error=${locked ? "locked" : "failed"}&next=${encodeURIComponent(next)}`);
    }
    throw e;
  }
}

/** Break-glass: the one-time link from the command line (docs/09). Signs in, then straight to setting it up again. */
export async function oneTimeLogin(formData: FormData) {
  try {
    await signIn("one-time-link", { token: formData.get("token"), redirectTo: "/me/sign-in" });
  } catch (e) {
    if (e instanceof AuthError) redirect("/login/admin?error=link");
    throw e;
  }
}
