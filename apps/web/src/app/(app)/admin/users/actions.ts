"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { lookupMinecraftUser } from "@/server/mojang";
import { MC_USERNAME_RE } from "@/server/auth/constants";

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

/** Admin tool (docs/14 keeps the Mojang lookup for admins only): set or verify a member's Minecraft account by name. */
export async function setMinecraftNameAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = z.object({ id: z.string().min(1), mcUsername: z.string().trim().regex(MC_USERNAME_RE) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/admin/users?error=name");
  const lookup = await lookupMinecraftUser(parsed.data.mcUsername);
  if (!lookup.ok) redirect(`/admin/users?error=${lookup.reason}`);
  const taken = await db.user.findFirst({ where: { mcUuid: lookup.uuid, NOT: { id: parsed.data.id } }, select: { displayName: true } });
  if (taken) redirect("/admin/users?error=taken");
  await db.user.update({ where: { id: parsed.data.id }, data: { mcUsername: lookup.name, mcUuid: lookup.uuid, verifiedAt: new Date() } });
  await db.auditLog.create({ data: { userId: admin.id, action: "user.setMinecraft", params: { id: parsed.data.id, mcUsername: lookup.name, mcUuid: lookup.uuid }, result: "OK" } });
  revalidatePath("/admin/users");
  redirect("/admin/users");
}

export async function clearMinecraftNameAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const u = await db.user.update({ where: { id }, data: { mcUsername: null, mcUuid: null, verifiedAt: null } }).catch(() => null);
  if (u) await db.auditLog.create({ data: { userId: admin.id, action: "user.clearMinecraft", params: { id }, result: "OK" } });
  revalidatePath("/admin/users");
  redirect("/admin/users");
}
