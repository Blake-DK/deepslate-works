import type { Prisma } from "@prisma/client";
import { db } from "./db.js";
import { auditMeta, describeAction, kindOf, type AuditResult } from "./shared/events.js";

/**
 * Records something the portal or a person did, as an Event (docs/16 §4; this used to be an AuditLog row).
 * `userId: null` with no role means api itself (join hook, timers). A caller id that is not a user is
 * recorded without an actor rather than failing the request. Never throws.
 */
export async function audit(data: { userId?: string | null; action: string; params: Prisma.InputJsonValue; result: string; detail?: string | null }) {
  try {
    const result = (["OK", "DENIED", "FAILED", "TIMEOUT"].includes(data.result) ? data.result : "OK") as AuditResult;
    const user = data.userId ? await db.user.findUnique({ where: { id: data.userId }, select: { role: true, displayName: true } }) : null;
    // No caller: api itself ("The portal let bramble09 in"). A caller that is not a member of the portal is somebody
    // using the service token directly, a script or a session on the VPS: "System".
    const actor = user ? { role: user.role, name: user.displayName } : data.userId ? { role: "system" as const, name: "System" } : { role: "system" as const, name: null };
    const detail = data.userId && !user ? `${data.detail ?? ""} [caller ${data.userId} not a user]`.trim() : (data.detail ?? null);
    await db.event.create({
      data: {
        kind: kindOf(data.action, actor.role),
        actor: user ? data.userId : null,
        message: describeAction(data.action, actor, data.params, result),
        meta: auditMeta(data.action, data.params, result, detail) as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    console.error(JSON.stringify({ level: 50, msg: "audit write failed", action: data.action, err: String(e) }));
  }
}
