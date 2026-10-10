"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { apiFetch, ApiError } from "@/server/api-client";

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
