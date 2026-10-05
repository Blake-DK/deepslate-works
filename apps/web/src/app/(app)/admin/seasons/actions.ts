"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { apiFetch, ApiError } from "@/server/api-client";
import { audit } from "@/server/events";
import { removeBuild, storeBuild } from "@/server/builds";

// docs/34 §6 (W1.4): Admin → Seasons. Every button is a named call to api, which checks, acts and writes the event
// log. Which button was pressed travels as a bound argument, never as the button's own value.

const OPS = z.enum(["announce", "start", "end", "reload"]);
const NEEDS_TICK: ReadonlySet<string> = new Set(["start", "end", "reload"]);
const to = (msg: string, detail?: string) => `/admin/seasons?msg=${msg}${detail ? `&detail=${encodeURIComponent(detail)}` : ""}`;

export async function seasonOpAction(which: string, formData: FormData) {
  const admin = await requireAdmin();
  const op = OPS.safeParse(which);
  if (!op.success) redirect(to("error", "Unknown action"));
  if (NEEDS_TICK.has(op.data) && formData.get("sure") !== "on") redirect(to("confirm"));
  try {
    await apiFetch(`/seasons/${op.data}`, { method: "POST", body: {}, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 30_000 });
  } catch (e) {
    if (e instanceof ApiError) redirect(to("error", e.message));
    throw e;
  }
  revalidatePath("/season");
  revalidatePath("/admin/seasons");
  redirect(to(op.data));
}

const tick = z.object({ userId: z.string().min(1).max(64), item: z.string().regex(/^(boss|trial):[a-z0-9_]{1,32}$/) });

export async function seasonTickAction(which: string, formData: FormData) {
  const admin = await requireAdmin();
  const op = z.enum(["grant", "revoke"]).safeParse(which);
  const input = tick.safeParse({ userId: formData.get("userId"), item: formData.get("item") });
  if (!op.success || !input.success) redirect(to("error", "Pick a member and a boss or trial"));
  const [kind, itemId] = input.data.item.split(":");
  let r: { added?: boolean; removed?: boolean; inGame?: boolean };
  try {
    r = await apiFetch(`/seasons/${op.data}`, { method: "POST", body: { userId: input.data.userId, kind, itemId }, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 30_000 });
  } catch (e) {
    if (e instanceof ApiError) redirect(to("error", e.message));
    throw e;
  }
  revalidatePath("/season");
  revalidatePath("/admin/seasons");
  if (op.data === "grant") redirect(to(r.added ? (r.inGame ? "granted" : "grantedSite") : "grantedAlready"));
  redirect(to(r.removed ? (r.inGame ? "revoked" : "revokedSite") : "revokedNone"));
}

// ---- docs/34 §10: builds. Numbers and a name from the form, checked here and again by api.
const int = z.coerce.number().int();
const dimension = z.string().regex(/^(minecraft:overworld|deepslate:frontier_[a-z0-9_]{1,32})$/);
const captureForm = z.object({ name: z.string().regex(/^[a-z0-9_]{2,24}$/), dimension, x1: int, y1: int, z1: int, x2: int, y2: int, z2: int });
// the build's field says which list it is from: "c:<name>" captured in the world, "u:<name>" uploaded
const placeForm = z.object({ name: z.string().regex(/^[cu]:[a-z0-9_]{2,24}$/), dimension, x: int, y: int, z: int });
const fields = (formData: FormData, names: string[]) => Object.fromEntries(names.map((n) => [n, formData.get(n)]));

export async function buildCaptureAction(formData: FormData) {
  const admin = await requireAdmin();
  const f = captureForm.safeParse(fields(formData, ["name", "dimension", "x1", "y1", "z1", "x2", "y2", "z2"]));
  if (!f.success) redirect(to("error", "A name in small letters, digits and _ (2 to 24), and whole numbers for both corners"));
  if (formData.get("sure") !== "on") redirect(to("confirm"));
  const { name, x1, y1, z1, x2, y2, z2 } = f.data;
  let r: { pieces?: number };
  try {
    r = await apiFetch("/builds/capture", { method: "POST", body: { name, dimension: f.data.dimension, from: { x: x1, y: y1, z: z1 }, to: { x: x2, y: y2, z: z2 } }, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 120_000 });
  } catch (e) {
    if (e instanceof ApiError) redirect(to("error", e.message));
    throw e;
  }
  revalidatePath("/admin/seasons");
  redirect(to("captured", `${name}, ${r.pieces ?? 1} ${r.pieces === 1 ? "piece" : "pieces"}`));
}

export async function buildPlaceAction(formData: FormData) {
  const admin = await requireAdmin();
  const f = placeForm.safeParse(fields(formData, ["name", "dimension", "x", "y", "z"]));
  if (!f.success) redirect(to("error", "Pick a build and give whole numbers for the position"));
  if (formData.get("sure") !== "on") redirect(to("confirm"));
  const { x, y, z: zz } = f.data;
  const name = f.data.name.slice(2);
  let r: { locked?: boolean };
  try {
    r = await apiFetch("/builds/place", { method: "POST", body: { name, upload: f.data.name.startsWith("u:"), dimension: f.data.dimension, at: { x, y, z: zz }, lock: formData.get("lock") === "on" }, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 120_000 });
  } catch (e) {
    if (e instanceof ApiError) redirect(to("error", e.message));
    throw e;
  }
  revalidatePath("/admin/seasons");
  redirect(to(formData.get("lock") === "on" ? (r.locked ? "placedLocked" : "placedNotLocked") : "placed", name));
}

/** A build file from the admin's PC, kept under a name. It reaches the server with the next Build and Sync. */
export async function buildUploadAction(formData: FormData) {
  const admin = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect(to("error", "Pick a file first"));
  const stored = await storeBuild(name, file);
  if (!stored.ok) redirect(to("error", stored.reason));
  await audit({ userId: admin.id, action: "build.upload", params: { name, format: stored.build.format, kb: Math.round(stored.build.bytes / 1024) }, result: "OK" });
  revalidatePath("/admin/seasons");
  redirect(to("uploaded", name));
}

export async function buildRemoveAction(formData: FormData) {
  const admin = await requireAdmin();
  const name = String(formData.get("name") ?? "");
  if (!(await removeBuild(name))) redirect(to("error", "No such upload"));
  await audit({ userId: admin.id, action: "build.uploadRemove", params: { name }, result: "OK" });
  revalidatePath("/admin/seasons");
  redirect(to("uploadRemoved", name));
}
