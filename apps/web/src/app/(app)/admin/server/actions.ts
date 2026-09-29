"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { apiFetch, ApiError } from "@/server/api-client";
import { audit } from "@/server/events";
import { removePhoto, storePhoto } from "@/server/news-images";

const ops = z.enum(["start", "stop", "restart"]);
const back = (msg: string, detail?: string) => `/admin/server?msg=${msg}${detail ? `&detail=${encodeURIComponent(detail)}` : ""}`;

export async function serverOpAction(formData: FormData) {
  const admin = await requireAdmin();
  const op = ops.safeParse(formData.get("op"));
  if (!op.success || formData.get("sure") !== "on") redirect(back("confirm"));
  try {
    await apiFetch(`/server/${op.data}`, { method: "POST", body: {}, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 30_000 });
  } catch (e) {
    if (e instanceof ApiError) redirect(back("error", e.message));
    throw e;
  }
  redirect(back(op.data));
}

export async function runActionAction(formData: FormData) {
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
    if (e instanceof ApiError) redirect(back("error", e.message));
    throw e;
  }
  redirect(back("action", name));
}

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const blank = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const pregenOn = z.object({
  mode: z.enum(["empty", "now"]),
  what: z.enum(["generate", "render", "both"]),
  radius: z.coerce.number().int().min(16).max(10_000),
  x: z.coerce.number().int().min(-100_000).max(100_000),
  z: z.coerce.number().int().min(-100_000).max(100_000),
  from: clock.nullable(),
  to: clock.nullable(),
  hours: z.coerce.number().min(0.25).max(240).nullable(),
});

/** Pre-generation is a mode, off by default (docs/05). */
export async function pregenAction(formData: FormData) {
  const admin = await requireAdmin();
  const caller = { id: admin.id, role: "ADMIN" as const };
  const op = String(formData.get("op") ?? "");
  try {
    if (op === "on") {
      const mode = String(formData.get("mode") ?? "");
      const parsed = pregenOn.safeParse({ mode, what: formData.get("what") || "both", radius: formData.get("radius") || 1500, x: formData.get("x") || 0, z: formData.get("z") || 0, from: blank(formData.get("from")), to: blank(formData.get("to")), hours: blank(formData.get(mode === "now" ? "hoursNow" : "hoursEmpty")) });
      if (!parsed.success) redirect(back("error", "The radius is between 16 and 10000, the hours between a quarter and 240, the times like 02:00."));
      const d = parsed.data;
      if (d.mode === "empty" && Boolean(d.from) !== Boolean(d.to)) redirect(back("error", "A window has a from and a to. Leave both empty for any time of day."));
      await apiFetch("/pregen/on", { method: "POST", body: { mode: d.mode, what: d.what, area: { x: d.x, z: d.z, radius: d.radius }, window: d.mode === "empty" && d.from && d.to ? { from: d.from, to: d.to } : null, capHours: d.hours }, caller, timeoutMs: 60_000 });
    } else if (op === "off") {
      await apiFetch("/pregen/off", { method: "POST", body: {}, caller, timeoutMs: 60_000 });
    } else if (op === "cancel") {
      await apiFetch("/pregen/cancel", { method: "POST", body: {}, caller, timeoutMs: 60_000 });
    } else redirect(back("error", "Unknown."));
  } catch (e) {
    if (e instanceof ApiError) redirect(back("error", e.message));
    throw e;
  }
  revalidatePath("/admin/server");
  redirect(back(op === "on" ? "pregenOn" : op === "off" ? "pregenPaused" : "pregenOff"));
}

/** Ends the server's process. Only offered, and only accepted by api, while the server is stuck in "Stopping". */
export async function killAction() {
  const admin = await requireAdmin();
  try {
    await apiFetch("/server/kill", { method: "POST", body: {}, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 30_000 });
  } catch (e) {
    if (e instanceof ApiError) redirect(back("error", e.message));
    throw e;
  }
  revalidatePath("/admin/server");
  redirect(back("killed"));
}

export async function scheduleRestartAction(formData: FormData) {
  const admin = await requireAdmin();
  const minutes = z.coerce.number().int().min(1).max(120).safeParse(formData.get("minutes"));
  if (!minutes.success) redirect(back("error", "Pick between 1 and 120 minutes."));
  if (formData.get("sure") !== "on") redirect(back("confirm"));
  try {
    await apiFetch("/server/restart-in", { method: "POST", body: { minutes: minutes.data }, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 15_000 });
  } catch (e) {
    if (e instanceof ApiError) redirect(back("error", e.message));
    throw e;
  }
  redirect(back("scheduled", `${minutes.data} min`));
}

export async function cancelRestartAction() {
  const admin = await requireAdmin();
  try {
    await apiFetch("/server/schedule", { method: "DELETE", caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 15_000 });
  } catch (e) {
    if (e instanceof ApiError) redirect(back("error", e.message));
    throw e;
  }
  redirect(back("cancelled"));
}

export async function backupAction(formData: FormData) {
  const admin = await requireAdmin();
  if (formData.get("sure") !== "on") redirect(back("confirm"));
  try {
    await apiFetch("/server/backup", { method: "POST", body: {}, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 60_000 });
  } catch (e) {
    if (e instanceof ApiError) redirect(back("error", e.message));
    throw e;
  }
  redirect(back("backup"));
}

const announcement = z.object({ body: z.string().trim().min(1).max(600), pinned: z.boolean(), say: z.boolean() });

export async function announceAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = announcement.safeParse({ body: formData.get("body"), pinned: formData.get("pinned") === "on", say: formData.get("say") === "on" });
  if (!parsed.success) redirect(back("error", "Write something first (600 characters at most)."));
  const { body, pinned, say } = parsed.data;
  const upload = formData.get("image");
  let image: string | null = null;
  if (upload instanceof File && upload.size > 0) {
    const stored = await storePhoto(upload);
    if (!stored.ok) redirect(back("error", stored.reason));
    image = stored.file;
  }
  await db.announcement.create({ data: { body, pinned, authorId: admin.id, image } });
  await audit({ userId: admin.id, action: "announcement.create", params: { pinned, say, length: body.length, image: Boolean(image) }, result: "OK" });
  for (const p of ["/", "/admin/server"]) revalidatePath(p);
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
  redirect(back("announced", said));
}

export async function announcementChangeAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = z.string().min(1).max(40).safeParse(formData.get("id"));
  const what = z.enum(["pin", "unpin", "delete", "picture", "nopicture"]).safeParse(formData.get("what"));
  if (!id.success || !what.success) redirect(back("error", "Unknown announcement."));
  const row = await db.announcement.findUnique({ where: { id: id.data }, select: { image: true } });
  if (!row) redirect(back("error", "Unknown announcement."));
  // a picture file is removed only when no other news item shows the same picture
  const drop = async (file: string | null) => {
    if (file && (await db.announcement.count({ where: { image: file } })) === 0) await removePhoto(file);
  };
  if (what.data === "delete") {
    await db.announcement.deleteMany({ where: { id: id.data } });
    await drop(row.image);
  } else if (what.data === "picture") {
    const upload = formData.get("image");
    if (!(upload instanceof File) || upload.size === 0) redirect(back("error", "Choose a picture first."));
    const stored = await storePhoto(upload);
    if (!stored.ok) redirect(back("error", stored.reason));
    await db.announcement.update({ where: { id: id.data }, data: { image: stored.file } });
    if (row.image !== stored.file) await drop(row.image);
  } else if (what.data === "nopicture") {
    await db.announcement.update({ where: { id: id.data }, data: { image: null } });
    await drop(row.image);
  } else await db.announcement.updateMany({ where: { id: id.data }, data: { pinned: what.data === "pin" } });
  await audit({ userId: admin.id, action: `announcement.${what.data}`, params: { id: id.data }, result: "OK" });
  for (const p of ["/", "/admin/server"]) revalidatePath(p);
  redirect(back("action", `announcement ${what.data}`));
}
