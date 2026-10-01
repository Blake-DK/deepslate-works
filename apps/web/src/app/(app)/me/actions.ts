"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOnboardedUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { audit } from "@/server/events";

// Visual extras (planner, 2026-10-01): the member's own choice, applied by the installer on their next Play.
const schema = z.object({ extras: z.enum(["off", "on"]), shader: z.enum(["none", "light", "full"]).default("none") });

export async function saveVisuals(formData: FormData): Promise<void> {
  const user = await requireOnboardedUser("/me");
  const parsed = schema.safeParse({ extras: formData.get("extras"), shader: formData.get("shader") ?? undefined });
  if (!parsed.success) return;
  const extras = parsed.data.extras === "on";
  // With extras off the shader choice is kept as it was, so switching back on brings it back.
  const data = extras ? { visualExtras: true, shaders: parsed.data.shader } : { visualExtras: false };
  if (user.visualExtras === extras && (!extras || user.shaders === parsed.data.shader)) return;
  await db.user.update({ where: { id: user.id }, data });
  await audit({ userId: user.id, action: "profile.visuals", params: { extras, shader: extras ? parsed.data.shader : "none" }, result: "OK" });
  revalidatePath("/me");
}
