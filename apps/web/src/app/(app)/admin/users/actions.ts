"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";

export async function setRoleAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = z.object({ id: z.string().min(1), role: z.enum(["ADMIN", "PLAYER"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success || parsed.data.id === admin.id) return;
  await db.user.update({ where: { id: parsed.data.id }, data: { role: parsed.data.role } });
  await db.auditLog.create({ data: { userId: admin.id, action: "user.setRole", params: parsed.data, result: "OK" } });
  revalidatePath("/admin/users");
}

export async function removeUserAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id || id === admin.id) return;
  const removed = await db.user.delete({ where: { id } }).catch(() => null);
  if (removed) {
    await db.auditLog.create({ data: { userId: admin.id, action: "user.remove", params: { id, displayName: removed.displayName, mcUsername: removed.mcUsername }, result: "OK" } });
  }
  revalidatePath("/admin/users");
}
