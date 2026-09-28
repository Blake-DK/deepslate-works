"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { lookupMinecraftUser } from "@/server/mojang";
import { MC_USERNAME_RE } from "@/server/auth/constants";

const schema = z.object({
  mcUsername: z.string().trim().regex(MC_USERNAME_RE, "username"),
  pcTier: z.enum(["LOW", "MID", "HIGH"], { message: "tier" }),
});

export async function completeOnboarding(formData: FormData) {
  const user = await requireUser();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/onboarding?error=${parsed.error.issues[0]?.message ?? "form"}`);
  const { mcUsername, pcTier } = parsed.data;
  const lookup = await lookupMinecraftUser(mcUsername);
  if (!lookup.ok) redirect(`/onboarding?error=${lookup.reason}`);
  const taken = await db.user.findFirst({ where: { mcUuid: lookup.uuid, NOT: { id: user.id } }, select: { id: true } });
  if (taken) redirect("/onboarding?error=taken");
  await db.user.update({ where: { id: user.id }, data: { mcUsername: lookup.name, mcUuid: lookup.uuid, pcTier } });
  await db.auditLog.create({ data: { userId: user.id, action: "profile.onboard", params: { mcUsername: lookup.name, pcTier }, result: "OK" } });
  redirect("/");
}
