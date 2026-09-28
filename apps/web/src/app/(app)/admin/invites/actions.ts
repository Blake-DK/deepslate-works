"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { createInvite } from "@/server/auth/invites";
import { db } from "@/server/db";

const schema = z.object({ note: z.string().trim().max(60).optional(), days: z.coerce.number().int().min(1).max(90).default(7) });

export async function createInviteAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await createInvite(admin.id, parsed.data.note || null, parsed.data.days);
  await db.auditLog.create({ data: { userId: admin.id, action: "invite.create", params: { note: parsed.data.note ?? null }, result: "OK" } });
  revalidatePath("/admin/invites");
}

export async function revokeInviteAction(formData: FormData) {
  const admin = await requireAdmin();
  const code = String(formData.get("code") ?? "");
  const res = await db.invite.deleteMany({ where: { code, usedBy: null } });
  if (res.count) await db.auditLog.create({ data: { userId: admin.id, action: "invite.revoke", params: { code }, result: "OK" } });
  revalidatePath("/admin/invites");
}
