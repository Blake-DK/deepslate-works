"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { safeNext } from "@/server/auth/next-url";
import { audit } from "@/server/events";

// docs/14 + Alex (2026-09-28): nobody types a Minecraft username. Linking happens in game. Only the PC question stays.
const schema = z.object({ pcTier: z.enum(["LOW", "MID", "HIGH"], { message: "tier" }) });

export async function completeOnboarding(formData: FormData) {
  const user = await requireUser();
  // Once the installer has measured the PC, the measurement stands (Alex, 2026-09-29). It is taken again at every install.
  if (user.pcTier && user.pcTierSource === "measured") redirect(safeNext(formData.get("next")));
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/onboarding?error=${parsed.error.issues[0]?.message ?? "form"}`);
  await db.user.update({ where: { id: user.id }, data: { pcTier: parsed.data.pcTier, pcTierSource: "self" } });
  await audit({ userId: user.id, action: "profile.onboard", params: { pcTier: parsed.data.pcTier }, result: "OK" });
  redirect(safeNext(formData.get("next")));
}
