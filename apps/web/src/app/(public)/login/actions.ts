"use server";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { env } from "@/env";
import { safeNext } from "@/server/auth/next-url";

export async function discordLogin(formData: FormData) {
  if (!env.discordEnabled) redirect("/login?error=discord-off");
  await signIn("discord", { redirectTo: safeNext(formData.get("next")) });
}

export async function emailLogin(formData: FormData) {
  const next = safeNext(formData.get("next"));
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
