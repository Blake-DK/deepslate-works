"use server";
import { parseNewsDates } from "@/lib/news";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { apiFetch, ApiError } from "@/server/api-client";
import { audit } from "@/server/events";
import { removePhoto, storePhoto } from "@/server/news-images";
import { photoInUse } from "@/server/polls";

const ops = z.enum(["start", "stop", "restart"]);
// Where to go after an action: the tab it belongs to, or the Control Room when its form says so. The form only
// picks from this list; an address it sends is never used as such.
const TABS = { power: "/admin/server", settings: "/admin/server?tab=performance", backups: "/admin/server?tab=backups", pregen: "/admin/server?tab=world", room: "/admin/joining?tab=room", news: "/admin/news" } as const;
function place(formData: FormData | undefined, tab: keyof typeof TABS) {
  const back = formData?.get("back");
  const base = back === "/admin" || back === "/" || back === "/admin/joining" ? back : TABS[tab];
  return (msg: string, detail?: string) => `${base}${base.includes("?") ? "&" : "?"}msg=${msg}${detail ? `&detail=${encodeURIComponent(detail)}` : ""}`;
}

// Which button was pressed travels as a bound argument (`action.bind(null, "stop")` as the button's formAction),
// never as the button's own name/value: the browser posted forms without it (2026-09-29, "Unknown announcement").
export async function serverOpAction(which: string, formData: FormData) {
  const to = place(formData, "power");
  const admin = await requireAdmin();
  const op = ops.safeParse(which);
  if (!op.success || formData.get("sure") !== "on") redirect(to("confirm"));
  try {
    await apiFetch(`/server/${op.data}`, { method: "POST", body: {}, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 30_000 });
  } catch (e) {
    if (e instanceof ApiError) redirect(to("error", e.message));
    throw e;
  }
  redirect(to(op.data));
}

export async function runActionAction(formData: FormData) {
  const to = place(formData, "room");
  const admin = await requireAdmin();
  const name = String(formData.get("action") ?? "");
  const input: Record<string, string> = {};
  for (const k of ["text", "name", "reason"]) {
    const v = formData.get(k);
    if (typeof v === "string" && v.trim()) input[k] = v.trim();
  }
  try {
    await apiFetch(`/actions/${encodeURIComponent(name)}`, { method: "POST", body: input, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 60_000 });
  } catch (e) {
    if (e instanceof ApiError) redirect(to("error", e.message));
    throw e;
  }
  redirect(to("action", name));
}

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const blank = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const pregenOn = z.object({
  mode: z.enum(["empty", "now"]),
  what: z.enum(["generate", "render", "both"]),
  purge: z.boolean(),
  radius: z.coerce.number().int().min(16).max(10_000),
  x: z.coerce.number().int().min(-100_000).max(100_000),
  z: z.coerce.number().int().min(-100_000).max(100_000),
  from: clock.nullable(),
  to: clock.nullable(),
  hours: z.coerce.number().min(0.25).max(240).nullable(),
});

/** Pre-generation is a mode, off by default (docs/05). */
export async function pregenAction(formData: FormData) {
  const to = place(formData, "pregen");
  const admin = await requireAdmin();
  const caller = { id: admin.id, role: "ADMIN" as const };
  const op = String(formData.get("op") ?? "");
  try {
    if (op === "on") {
      const mode = String(formData.get("mode") ?? "");
      const parsed = pregenOn.safeParse({ mode, what: formData.get("what") || "both", purge: formData.get("purge") === "1", radius: formData.get("radius") || 1500, x: formData.get("x") || 0, z: formData.get("z") || 0, from: blank(formData.get("from")), to: blank(formData.get("to")), hours: blank(formData.get(mode === "now" ? "hoursNow" : "hoursEmpty")) });
      if (!parsed.success) redirect(to("error", "The radius is between 16 and 10000, the hours between a quarter and 240, the times like 02:00."));
      const d = parsed.data;
      if (d.mode === "empty" && Boolean(d.from) !== Boolean(d.to)) redirect(to("error", "A window has a from and a to. Leave both empty for any time of day."));
      await apiFetch("/pregen/on", { method: "POST", body: { mode: d.mode, what: d.purge && d.what === "generate" ? "render" : d.what, purge: d.purge, area: { x: d.x, z: d.z, radius: d.radius }, window: d.mode === "empty" && d.from && d.to ? { from: d.from, to: d.to } : null, capHours: d.hours }, caller, timeoutMs: 60_000 });
    } else if (op === "map-reload") {
      await apiFetch("/pregen/map-reload", { method: "POST", body: {}, caller, timeoutMs: 30_000 });
    } else if (op === "off") {
      await apiFetch("/pregen/off", { method: "POST", body: {}, caller, timeoutMs: 60_000 });
    } else if (op === "cancel") {
      await apiFetch("/pregen/cancel", { method: "POST", body: {}, caller, timeoutMs: 60_000 });
    } else redirect(to("error", "Unknown."));
  } catch (e) {
    if (e instanceof ApiError) redirect(to("error", e.message));
    throw e;
  }
  revalidatePath("/admin/server");
  redirect(to(op === "on" ? "pregenOn" : op === "off" ? "pregenPaused" : op === "map-reload" ? "mapReloaded" : "pregenOff"));
}

/** Admin → Server → Settings: view and simulation distance, written to AMP; "now" restarts in one minute with a warning. */
export async function distanceAction(apply: string, formData: FormData) {
  const to = place(formData, "settings");
  const admin = await requireAdmin();
  const when = z.enum(["now", "next"]).safeParse(apply);
  const view = z.coerce.number().int().min(4).max(16).safeParse(formData.get("view"));
  const sim = z.coerce.number().int().min(4).max(12).safeParse(formData.get("sim"));
  if (!when.success || !view.success || !sim.success) redirect(to("error", "View distance is 4 to 16, simulation distance 4 to 12."));
  let restart: { at: string } | null = null;
  try {
    ({ restart } = await apiFetch<{ restart: { at: string } | null }>("/server/distance", { method: "POST", body: { view: view.data, sim: sim.data, apply: when.data }, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 30_000 }));
  } catch (e) {
    if (e instanceof ApiError) redirect(to("error", e.message));
    throw e;
  }
  revalidatePath("/admin/server");
  redirect(to(restart ? "distanceNow" : "distanceNext"));
}

/** Ends the server's process. Only offered, and only accepted by api, while the server is stuck in "Stopping". */
/** Admin → Control Room, "In the entrance room": lets a held, linked member in now (api `POST /held/release`, audited there). */
export async function releaseHeldAction(formData: FormData) {
  const to = place(formData, "power");
  const admin = await requireAdmin();
  const name = z.string().regex(/^[A-Za-z0-9_]{3,16}$/).safeParse(formData.get("name"));
  if (!name.success) redirect(to("error", "Unknown player"));
  try {
    await apiFetch("/held/release", { method: "POST", body: { name: name.data }, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 30_000 });
  } catch (e) {
    if (e instanceof ApiError) redirect(to("error", e.message));
    throw e;
  }
  revalidatePath("/admin");
  revalidatePath("/admin/joining");
  redirect(to("released", name.data));
}

export async function killAction(formData?: FormData) {
  const to = place(formData, "power");
  const admin = await requireAdmin();
  try {
    await apiFetch("/server/kill", { method: "POST", body: {}, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 30_000 });
  } catch (e) {
    if (e instanceof ApiError) redirect(to("error", e.message));
    throw e;
  }
  revalidatePath("/admin/server");
  redirect(to("killed"));
}

export async function scheduleRestartAction(formData: FormData) {
  const to = place(formData, "power");
  const admin = await requireAdmin();
  const minutes = z.coerce.number().int().min(1).max(120).safeParse(formData.get("minutes"));
  if (!minutes.success) redirect(to("error", "Pick between 1 and 120 minutes."));
  if (formData.get("sure") !== "on") redirect(to("confirm"));
  try {
    await apiFetch("/server/restart-in", { method: "POST", body: { minutes: minutes.data }, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 15_000 });
  } catch (e) {
    if (e instanceof ApiError) redirect(to("error", e.message));
    throw e;
  }
  redirect(to("scheduled", `${minutes.data} min`));
}

export async function cancelRestartAction(formData?: FormData) {
  const to = place(formData, "power");
  const admin = await requireAdmin();
  try {
    await apiFetch("/server/schedule", { method: "DELETE", caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 15_000 });
  } catch (e) {
    if (e instanceof ApiError) redirect(to("error", e.message));
    throw e;
  }
  redirect(to("cancelled"));
}

export async function backupAction(formData: FormData) {
  const to = place(formData, "backups");
  const admin = await requireAdmin();
  if (formData.get("sure") !== "on") redirect(to("confirm"));
  try {
    await apiFetch("/server/backup", { method: "POST", body: {}, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 60_000 });
  } catch (e) {
    if (e instanceof ApiError) redirect(to("error", e.message));
    throw e;
  }
  redirect(to("backup"));
}

const announcement = z.object({ body: z.string().trim().min(1).max(600), pinned: z.boolean(), say: z.boolean() });

export async function announceAction(formData: FormData) {
  const to = place(formData, "news");
  const admin = await requireAdmin();
  const parsed = announcement.safeParse({ body: formData.get("body"), pinned: formData.get("pinned") === "on", say: formData.get("say") === "on" });
  if (!parsed.success) redirect(to("error", "Write something first (600 characters at most)."));
  const { body, say } = parsed.data;
  const dates = parseNewsDates(String(formData.get("pinnedUntil") ?? ""), String(formData.get("expiresAt") ?? ""), new Date());
  if (!dates.ok) redirect(to("error", dates.reason));
  const pinned = parsed.data.pinned || dates.pinnedUntil !== null; // a "pinned until" date pins it
  const upload = formData.get("image");
  let image: string | null = null;
  if (upload instanceof File && upload.size > 0) {
    const stored = await storePhoto(upload);
    if (!stored.ok) redirect(to("error", stored.reason));
    image = stored.file;
  }
  const item = await db.announcement.create({ data: { body, pinned, pinnedUntil: dates.pinnedUntil, expiresAt: dates.expiresAt, authorId: admin.id, image } });
  // announcementId: the Discord feed reads the item itself (docs/21 §4 News)
  await audit({ userId: admin.id, action: "announcement.create", params: { announcementId: item.id, pinned, say, length: body.length, image: Boolean(image) }, result: "OK" });
  for (const p of ["/", "/admin/news"]) revalidatePath(p);
  let said = "";
  if (say) {
    // In game it is one chat line: first line only, 200 characters.
    const line = (body.split(/\r?\n/).find((l) => l.trim()) ?? "").trim().slice(0, 200);
    try {
      await apiFetch("/actions/server.say", { method: "POST", body: { text: line }, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 30_000 });
      said = "and said in game";
    } catch (e) {
      said = `but not said in game: ${e instanceof ApiError ? e.message : "the server could not be reached"}`;
    }
  }
  redirect(to("announced", said));
}

export async function announcementChangeAction(which: string, formData: FormData) {
  const to = place(formData, "news");
  const admin = await requireAdmin();
  const id = z.string().min(1).max(40).safeParse(formData.get("id"));
  const what = z.enum(["pin", "unpin", "delete", "picture", "nopicture"]).safeParse(which);
  if (!id.success || !what.success) redirect(to("error", "Unknown announcement."));
  const row = await db.announcement.findUnique({ where: { id: id.data }, select: { image: true } });
  if (!row) redirect(to("error", "Unknown announcement."));
  // a picture file is removed only when no other news item, and no poll's option (docs/35 R-40), shows the same picture
  const drop = async (file: string | null) => {
    if (file && !(await photoInUse(file))) await removePhoto(file);
  };
  if (what.data === "delete") {
    await db.announcement.deleteMany({ where: { id: id.data } });
    await drop(row.image);
  } else if (what.data === "picture") {
    const upload = formData.get("image");
    if (!(upload instanceof File) || upload.size === 0) redirect(to("error", "Choose a picture first."));
    const stored = await storePhoto(upload);
    if (!stored.ok) redirect(to("error", stored.reason));
    await db.announcement.update({ where: { id: id.data }, data: { image: stored.file } });
    if (row.image !== stored.file) await drop(row.image);
  } else if (what.data === "nopicture") {
    await db.announcement.update({ where: { id: id.data }, data: { image: null } });
    await drop(row.image);
  } else await db.announcement.updateMany({ where: { id: id.data }, data: { pinned: what.data === "pin", pinnedUntil: null } }); // Pin = until unpinned
  await audit({ userId: admin.id, action: `announcement.${what.data}`, params: { id: id.data }, result: "OK" });
  for (const p of ["/", "/admin/news"]) revalidatePath(p);
  redirect(to("action", `announcement ${what.data}`));
}

/** The two optional dates of one news item; empty boxes clear them. A "pinned until" date pins it. */
export async function announcementDatesAction(formData: FormData) {
  const to = place(formData, "news");
  const admin = await requireAdmin();
  const id = z.string().min(1).max(40).safeParse(formData.get("id"));
  if (!id.success) redirect(to("error", "Unknown announcement."));
  const dates = parseNewsDates(String(formData.get("pinnedUntil") ?? ""), String(formData.get("expiresAt") ?? ""), new Date());
  if (!dates.ok) redirect(to("error", dates.reason));
  const row = await db.announcement.findUnique({ where: { id: id.data }, select: { pinned: true } });
  if (!row) redirect(to("error", "Unknown announcement."));
  await db.announcement.update({ where: { id: id.data }, data: { pinnedUntil: dates.pinnedUntil, expiresAt: dates.expiresAt, ...(dates.pinnedUntil ? { pinned: true } : {}) } });
  await audit({ userId: admin.id, action: "announcement.dates", params: { id: id.data, pinnedUntil: dates.pinnedUntil?.toISOString() ?? null, expiresAt: dates.expiresAt?.toISOString() ?? null }, result: "OK" });
  for (const p of ["/", "/admin/news"]) revalidatePath(p);
  redirect(to("action", "announcement dates"));
}

/** Admin → Server → Settings: "Clear ground items now" (60 s warning in chat, then items older than 2 minutes go). */
export async function groundClearAction(formData: FormData) {
  const to = place(formData, "settings");
  const admin = await requireAdmin();
  if (formData.get("sure") !== "on") redirect(to("confirm"));
  try {
    await apiFetch("/server/ground/clear", { method: "POST", body: {}, caller: { id: admin.id, role: "ADMIN" } });
  } catch (e) {
    if (e instanceof ApiError) redirect(to("error", e.message));
    throw e;
  }
  revalidatePath("/admin/server");
  redirect(to("groundClear"));
}

/** Admin → Server → Settings: the automatic clear, off by default; when on, only above the threshold. */
export async function groundPlanAction(formData: FormData) {
  const to = place(formData, "settings");
  const admin = await requireAdmin();
  const threshold = z.coerce.number().int().min(200).max(20_000).safeParse(formData.get("threshold"));
  if (!threshold.success) redirect(to("error", "The threshold is a whole number from 200 to 20,000."));
  try {
    await apiFetch("/server/ground/plan", { method: "POST", body: { auto: formData.get("auto") === "on", threshold: threshold.data }, caller: { id: admin.id, role: "ADMIN" } });
  } catch (e) {
    if (e instanceof ApiError) redirect(to("error", e.message));
    throw e;
  }
  revalidatePath("/admin/server");
  redirect(to("groundPlan"));
}
