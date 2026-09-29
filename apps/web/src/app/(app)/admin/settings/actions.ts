"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { setSettings } from "@/server/settings";
import { ukLocalToDate } from "@/lib/uk-time";
import { audit } from "@/server/events";

const schema = z.object({ live: z.enum(["on", "off"]).default("off"), launchAt: z.string().optional() });

export async function saveSettingsAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = schema.safeParse({ live: formData.get("live") ? "on" : "off", launchAt: formData.get("launchAt") ?? undefined });
  if (!parsed.success) redirect("/admin/settings?error=form");
  let launchAt: Date | null = null;
  if (parsed.data.launchAt) {
    launchAt = ukLocalToDate(parsed.data.launchAt); // the box has no zone; the group is in the UK
    if (!launchAt) redirect("/admin/settings?error=form");
  }
  const live = parsed.data.live === "on";
  await setSettings({ live, launchAt }, admin.id);
  await audit({ userId: admin.id, action: "site.settings", params: { live, launchAt: launchAt?.toISOString() ?? null }, result: "OK" });
  for (const p of ["/", "/install", "/me", "/admin/settings"]) revalidatePath(p);
  redirect("/admin/settings?saved=1");
}
