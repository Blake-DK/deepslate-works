"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import { audit } from "@/server/events";
import { getSection, setSection } from "@/server/site-settings";
import { readImage, SLOTS, storeImage, tidy } from "@/server/branding";
import { DEFAULT_GUIDE } from "@/lib/guide-default";
import { apiFetch, ApiError } from "@/server/api-client";
import { readOption } from "@/server/logo-options";
import { pngSize, svgSquare } from "@/lib/image-size";

const text = (f: FormData, k: string) => String(f.get(k) ?? "");
const ownGuide = (t: string) => {
  const v = t.replace(/\r\n?/g, "\n");
  return v.trim() === "" || v.trim() === DEFAULT_GUIDE.trim() ? "" : v;
};

// Where a save goes back to: the form names its page from this list; an address it sends is never used as such.
const FROM = { look: "/admin/site?tab=look&", pages: "/admin/site?tab=pages&", motd: "/admin/server?tab=world&", invite: "/admin/discord?tab=connection&" } as const;

export async function saveBrandingAction(formData: FormData) {
  const admin = await requireAdmin();
  const current = await getSection("branding");
  const from = text(formData, "from");
  const back = Object.hasOwn(FROM, from) ? FROM[from as keyof typeof FROM] : FROM.look;
  const sent = (k: "name" | "tagline" | "footer" | "motd" | "motd2") => (formData.has(k) ? text(formData, k) : current[k]);
  const next: Record<string, unknown> = {
    ...current,
    // docs/35: the fields sit on four pages now (Site → Look and Pages, Server → World & map, Discord), each with a
    // form of its own. A field that was not in the form that was sent is left as it is.
    name: sent("name"),
    tagline: sent("tagline"),
    // accent, accentDark and defaultTheme are kept as stored: the site has one theme (docs/23 §3); accent still colours Discord's embeds
    discordInvite: formData.has("discordInvite") ? text(formData, "discordInvite").trim() : current.discordInvite,
    footer: sent("footer"),
    rules: formData.has("rules") ? text(formData, "rules").replace(/\r\n?/g, "\n") : current.rules,
    // Not in the form that was sent: left as it is. Sent as it ships, or empty: nothing of the admin's own is kept,
    // so the guide goes on following docs/18 as that changes.
    guide: formData.has("guide") ? ownGuide(text(formData, "guide")) : current.guide,
    motd: sent("motd"),
    motd2: sent("motd2"),
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
    redirect(`${back}error=${encodeURIComponent(problems.join(" ").slice(0, 400))}`);
  }
  const saved = await setSection("branding", next, admin.id);
  if (!saved.ok) {
    await audit({ userId: admin.id, action: "branding.save", params: { problems: saved.problems }, result: "DENIED" });
    redirect(`${back}error=${encodeURIComponent(saved.problems.join("; ").slice(0, 400))}`);
  }
  for (const s of stored) await tidy(s.slot, s.file);
  const changed = Object.keys(saved.value).filter((k) => JSON.stringify((saved.value as Record<string, unknown>)[k]) !== JSON.stringify((current as Record<string, unknown>)[k]));
  await audit({ userId: admin.id, action: "branding.save", params: { changed }, result: "OK" });
  // the server list's text lives in AMP's own setting: sent there, for the next server start
  if (changed.includes("motd") || changed.includes("motd2")) {
    try {
      await apiFetch("/branding/motd", { method: "POST", body: { line1: saved.value.motd, line2: saved.value.motd2 }, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 15_000 });
      notes.push("The server description goes to the server at its next start.");
    } catch (e) {
      notes.push(e instanceof ApiError ? e.message : "The server description could not be sent to AMP.");
    }
  }
  revalidatePath("/", "layout");
  redirect(`${back}saved=1${notes.length ? `&note=${encodeURIComponent(notes.join(" ").slice(0, 400))}` : ""}${changed.includes("name") ? "&renamed=1" : ""}`);
}

const BACK = "/admin/site?tab=look";

/** Sends the picture to api, which makes every size (site, server icon, window icon, app), then records the choice. */
async function applyLogo(adminId: string, choice: string, kind: "svg" | "png", data: Buffer, pixel?: boolean): Promise<string | null> {
  try {
    await apiFetch("/branding/logo", { method: "POST", body: { choice, kind, data: data.toString("base64"), ...(pixel === undefined ? {} : { pixel }) }, caller: { id: adminId, role: "ADMIN" }, timeoutMs: 180_000 });
  } catch (e) {
    return e instanceof ApiError ? e.message : "The logo could not be made.";
  }
  const current = await getSection("branding");
  const saved = await setSection("branding", { ...current, logoChoice: choice }, adminId);
  return saved.ok ? null : saved.problems.join("; ");
}

/** "Use this" on one of the eight options; the option travels bound to the button, never as a button value. */
export async function pickLogoAction(id: string) {
  const admin = await requireAdmin();
  const svg = await readOption(id);
  if (!svg) redirect(`${BACK}&error=${encodeURIComponent("There is no such logo.")}`);
  const problem = await applyLogo(admin.id, `option:${id}`, "svg", Buffer.from(svg, "utf8"));
  if (problem) redirect(`${BACK}&error=${encodeURIComponent(problem.slice(0, 400))}`);
  revalidatePath("/", "layout");
  redirect(`${BACK}&saved=1&note=${encodeURIComponent("Logo in use on the site now. The server list shows it after the next Sync and server start; PCs get it at their next Play.")}`);
}

/** "Upload your own": a square PNG (at least 512 px) or a square SVG. */
export async function uploadLogoAction(formData: FormData) {
  const admin = await requireAdmin();
  const file = formData.get("own");
  if (!(file instanceof File) || file.size === 0) redirect(`${BACK}&error=${encodeURIComponent("Pick a file first.")}`);
  const head = Buffer.from(await file.slice(0, 64).arrayBuffer());
  const isPng = head.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  if (isPng) {
    const size = pngSize(head);
    if (!size || size.width !== size.height || size.width < 512) redirect(`${BACK}&error=${encodeURIComponent(`A PNG logo must be square and at least 512 px${size ? ` (this one is ${size.width}×${size.height})` : ""}.`)}`);
  }
  // SVGs are rebuilt from the allow-list, as every uploaded picture is (storeImage); PNGs are checked for what they are
  const r = await storeImage("logo", file);
  if (!r.ok) redirect(`${BACK}&error=${encodeURIComponent(r.reason)}`);
  if (r.kind !== "png" && r.kind !== "svg") redirect(`${BACK}&error=${encodeURIComponent("Use a PNG or an SVG.")}`);
  const data = await readImage(r.file);
  if (!data) redirect(`${BACK}&error=${encodeURIComponent("The upload went missing.")}`);
  if (r.kind === "svg" && !svgSquare(data.data.toString("utf8"))) redirect(`${BACK}&error=${encodeURIComponent("An SVG logo must be square (its viewBox).")}`);
  const problem = await applyLogo(admin.id, `upload:${r.file}`, r.kind, data.data);
  if (problem) redirect(`${BACK}&error=${encodeURIComponent(problem.slice(0, 400))}`);
  await tidy("logo", r.file);
  revalidatePath("/", "layout");
  redirect(`${BACK}&saved=1&note=${encodeURIComponent("Your logo is in use on the site now. The server list shows it after the next Sync and server start; PCs get it at their next Play.")}`);
}
