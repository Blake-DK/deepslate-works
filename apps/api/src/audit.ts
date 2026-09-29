import type { Prisma } from "@prisma/client";
import { db } from "./db.js";

/** Writes an AuditLog row; an unknown caller id (not a User) is recorded as no user rather than failing the request. */
export async function audit(data: { userId?: string | null; action: string; params: Prisma.InputJsonValue; result: string; detail?: string | null }) {
  try {
    await db.auditLog.create({ data: { ...data, params: data.params ?? {} } });
  } catch {
    await db.auditLog.create({ data: { ...data, userId: null, params: data.params ?? {}, detail: `${data.detail ?? ""} [caller ${data.userId ?? "-"} not a user]`.trim() } }).catch(() => {});
  }
}
