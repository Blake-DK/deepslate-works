"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import { audit } from "@/server/events";
import { getSection, setSection } from "@/server/site-settings";
import { SLOTS, storeImage, tidy } from "@/server/branding";
import { DEFAULT_GUIDE } from "@/lib/guide-default";

const text = (f: FormData, k: string) => String(f.get(k) ?? "");
const ownGuide = (t: string) => {
  const v = t.replace(/\r\n?/g, "\n");
  return v.trim() === "" || v.trim() === DEFAULT_GUIDE.trim() ? "" : v;
};

export async function saveBrandingAction(formData: FormData) {
  const admin = await requireAdmin();
  const current = await getSection("branding");
  const next: Record<string, unknown> = {
    ...current,
    name: text(formData, "name"),
    tagline: text(formData, "tagline"),
    accent: text(formData, "accent").toLowerCase(),
    accentDark: text(formData, "accentDark").toLowerCase(),
    defaultTheme: text(formData, "defaultTheme"),
    discordInvite: text(formData, "discordInvite").trim(),
    footer: text(formData, "footer"),
    rules: text(formData, "rules").replace(/\r\n?/g, "\n"),
    // Not in the form that was sent: left as it is. Sent as it ships, or empty: nothing of the admin's own is kept,
    // so the guide goes on following docs/18 as that changes.
    guide: formData.has("guide") ? ownGuide(text(formData, "guide")) : current.guide,
    motd: text(formData, "motd"),
  };
  const notes: string[] = [];
  const problems: string[] = [];
  const stored: Array<{ slot: (typeof SLOTS)[number]; file: string }> = [];
  for (const slot of SLOTS) {
    if (formData.get(`${slot}Remove`) === "on") {
      next[slot] = "";
      stored.push({ slot, file: "" });
      continue;
    }
    const upload = formData.get(slot);
    if (!(upload instanceof File) || upload.size === 0) continue;
    const r = await storeImage(slot, upload);
    if (!r.ok) {
      problems.push(`${slot}: ${r.reason}`);
      continue;
    }
    next[slot] = r.file;
    stored.push({ slot, file: r.file });
    if (r.dropped.length) notes.push(`${slot}: removed from the SVG: ${r.dropped.join(", ")}`);
  }
  if (problems.length) {
    await audit({ userId: admin.id, action: "branding.save", params: { problems }, result: "DENIED" });
    redirect(`/admin/branding?error=${encodeURIComponent(problems.join(" ").slice(0, 400))}`);
  }
  const saved = await setSection("branding", next, admin.id);
  if (!saved.ok) {
    await audit({ userId: admin.id, action: "branding.save", params: { problems: saved.problems }, result: "DENIED" });
    redirect(`/admin/branding?error=${encodeURIComponent(saved.problems.join("; ").slice(0, 400))}`);
  }
  for (const s of stored) await tidy(s.slot, s.file);
  const changed = Object.keys(saved.value).filter((k) => JSON.stringify((saved.value as Record<string, unknown>)[k]) !== JSON.stringify((current as Record<string, unknown>)[k]));
  await audit({ userId: admin.id, action: "branding.save", params: { changed }, result: "OK" });
  revalidatePath("/", "layout");
  redirect(`/admin/branding?saved=1${notes.length ? `&note=${encodeURIComponent(notes.join(" ").slice(0, 400))}` : ""}${changed.includes("name") ? "&renamed=1" : ""}`);
}
