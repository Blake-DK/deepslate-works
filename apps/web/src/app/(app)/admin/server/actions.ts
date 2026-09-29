"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { apiFetch, ApiError } from "@/server/api-client";

const ops = z.enum(["start", "stop", "restart"]);

export async function serverOpAction(formData: FormData) {
  const admin = await requireAdmin();
  const op = ops.safeParse(formData.get("op"));
  if (!op.success || formData.get("sure") !== "on") redirect("/admin/server?msg=confirm");
  try {
    await apiFetch(`/server/${op.data}`, { method: "POST", body: {}, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 30_000 });
    redirect(`/admin/server?msg=${op.data}`);
  } catch (e) {
    if (e instanceof ApiError) redirect(`/admin/server?msg=error&detail=${encodeURIComponent(e.message)}`);
    throw e;
  }
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
    redirect(`/admin/server?msg=action&detail=${encodeURIComponent(name)}`);
  } catch (e) {
    if (e instanceof ApiError) redirect(`/admin/server?msg=error&detail=${encodeURIComponent(e.message)}`);
    throw e;
  }
}
