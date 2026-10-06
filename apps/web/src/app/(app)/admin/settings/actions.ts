"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { getSettings, setSettings } from "@/server/settings";
import { getSection, setSection } from "@/server/site-settings";
import { ukLocalToDate } from "@/lib/uk-time";
import { audit } from "@/server/events";

const schema = z.object({ live: z.enum(["on", "off"]).default("off"), launchAt: z.string().optional() });

export async function saveSettingsAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = schema.safeParse({ live: formData.get("live") ? "on" : "off", launchAt: formData.get("launchAt") ?? undefined });
  if (!parsed.success) redirect("/admin/joining?tab=rules&error=form");
  let launchAt: Date | null = null;
  if (parsed.data.launchAt) {
    launchAt = ukLocalToDate(parsed.data.launchAt); // the box has no zone; the group is in the UK
    if (!launchAt) redirect("/admin/joining?tab=rules&error=form");
  }
  const live = parsed.data.live === "on";
  const was = (await getSettings()).live;
  await setSettings({ live, launchAt }, admin.id);
  // was: the Discord feed posts "We're live" when this goes from off to on (docs/21 §4)
  await audit({ userId: admin.id, action: "site.settings", params: { live, was, launchAt: launchAt?.toISOString() ?? null }, result: "OK" });
  for (const p of ["/", "/help", "/me", "/admin/joining"]) revalidatePath(p);
  redirect("/admin/joining?tab=rules&saved=1");
}

const on = (v: FormDataEntryValue | null) => v === "on";
const int = (v: FormDataEntryValue | null) => (typeof v === "string" && /^\d{1,5}$/.test(v.trim()) ? Number(v) : Number.NaN);

// docs/35: each card sits with what it changes, so each section goes back to its own page.
const PLACE = { privacy: "/admin/site?tab=privacy", retention: "/admin/site?tab=privacy", files: "/admin/server?tab=files", joining: "/admin/joining?tab=rules" } as const;

async function save(section: "privacy" | "retention" | "files" | "joining", value: unknown, adminId: string) {
  const r = await setSection(section, value, adminId);
  await audit({ userId: adminId, action: "settings.save", params: { section, ...(r.ok ? { value: r.value } : { problems: r.problems }) }, result: r.ok ? "OK" : "DENIED" });
  for (const p of ["/admin/site", "/admin/joining", "/players", "/admin/server", "/", "/me", "/help"]) revalidatePath(p);
  const back = PLACE[section];
  redirect(r.ok ? `${back}&saved=${section}` : `${back}&error=${section}&detail=${encodeURIComponent(r.problems.join("; ").slice(0, 300))}`);
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
