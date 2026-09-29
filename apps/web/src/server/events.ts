import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { auditMeta, describeAction, kindOf, type AuditResult } from "@/shared/events";

type Client = Pick<Prisma.TransactionClient, "event" | "user">;

export type AuditInput = { userId?: string | null; action: string; params?: unknown; result?: AuditResult | string; detail?: string | null };

/**
 * Records something a person (or the portal) did. This is what `AuditLog` rows used to be: an Event of kind
 * ADMIN_ACTION / PLAYER_ACTION (or LINK, REVOKE, SYNC, BACKUP), with the action, parameters and result in `meta`.
 * Pass the transaction client as the second argument to write inside a transaction.
 */
export async function audit(input: AuditInput, client: Client = db): Promise<void> {
  const result = (["OK", "DENIED", "FAILED", "TIMEOUT"].includes(String(input.result)) ? input.result : "OK") as AuditResult;
  const user = input.userId ? await client.user.findUnique({ where: { id: input.userId }, select: { role: true, displayName: true } }) : null;
  const actor = { role: user?.role ?? null, name: user?.displayName ?? null };
  await client.event.create({
    data: {
      kind: kindOf(input.action, actor.role),
      actor: user ? input.userId : null,
      message: describeAction(input.action, actor, input.params, result),
      meta: auditMeta(input.action, input.params, result, input.detail) as Prisma.InputJsonValue,
    },
  });
}
