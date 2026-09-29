"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { apiFetch, ApiError } from "@/server/api-client";

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
  await db.announcement.create({ data: { body, pinned, authorId: admin.id } });
  await db.auditLog.create({ data: { userId: admin.id, action: "announcement.create", params: { pinned, say, length: body.length }, result: "OK" } });
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
  const what = z.enum(["pin", "unpin", "delete"]).safeParse(formData.get("what"));
  if (!id.success || !what.success) redirect(back("error", "Unknown announcement."));
  if (what.data === "delete") await db.announcement.deleteMany({ where: { id: id.data } });
  else await db.announcement.updateMany({ where: { id: id.data }, data: { pinned: what.data === "pin" } });
  await db.auditLog.create({ data: { userId: admin.id, action: `announcement.${what.data}`, params: { id: id.data }, result: "OK" } });
  for (const p of ["/", "/admin/server"]) revalidatePath(p);
  redirect(back("action", `announcement ${what.data}`));
}
