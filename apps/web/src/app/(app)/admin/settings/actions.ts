"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { setSettings } from "@/server/settings";
import { getSection, setSection } from "@/server/site-settings";
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

const on = (v: FormDataEntryValue | null) => v === "on";
const int = (v: FormDataEntryValue | null) => (typeof v === "string" && /^\d{1,5}$/.test(v.trim()) ? Number(v) : Number.NaN);

async function save(section: "privacy" | "retention" | "files" | "joining", value: unknown, adminId: string) {
  const r = await setSection(section, value, adminId);
  await audit({ userId: adminId, action: "settings.save", params: { section, ...(r.ok ? { value: r.value } : { problems: r.problems }) }, result: r.ok ? "OK" : "DENIED" });
  for (const p of ["/admin/settings", "/analytics", "/admin/files", "/", "/me", "/install"]) revalidatePath(p);
  redirect(r.ok ? `/admin/settings?saved=${section}` : `/admin/settings?error=${section}&detail=${encodeURIComponent(r.problems.join("; ").slice(0, 300))}`);
}

export async function savePrivacyAction(formData: FormData) {
  const admin = await requireAdmin();
  await save("privacy", { geo: on(formData.get("geo")), chat: on(formData.get("chat")), analyticsForPlayers: on(formData.get("analyticsForPlayers")) }, admin.id);
}

export async function saveJoiningAction(formData: FormData) {
  const admin = await requireAdmin();
  await save("joining", { requirePlay: on(formData.get("requirePlay")), windowMin: int(formData.get("windowMin")) }, admin.id);
}

export async function saveRetentionAction(formData: FormData) {
  const admin = await requireAdmin();
  await save("retention", { chatDays: int(formData.get("chatDays")), eventDays: int(formData.get("eventDays")), ipDays: int(formData.get("ipDays")), installDays: int(formData.get("installDays")) }, admin.id);
}

export async function saveFilesAction(formData: FormData) {
  const admin = await requireAdmin();
  const current = await getSection("files");
  const denied = String(formData.get("denied") ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  await save("files", { ...current, maxDownloadMb: int(formData.get("maxDownloadMb")), maxPreviewKb: int(formData.get("maxPreviewKb")), denied }, admin.id);
}
