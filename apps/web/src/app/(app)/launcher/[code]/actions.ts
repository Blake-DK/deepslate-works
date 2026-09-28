"use server";
import { redirect } from "next/navigation";
import { requireOnboardedUser } from "@/server/auth/session";
import { approveLauncherAuth } from "@/server/launcher";
import { db } from "@/server/db";
import { normaliseInviteCode } from "@/server/auth/invite-codes";

export async function decideLauncherAction(formData: FormData) {
  const user = await requireOnboardedUser();
  const code = normaliseInviteCode(String(formData.get("code") ?? ""));
  const approve = formData.get("decision") === "approve";
  const result = await approveLauncherAuth(code, user.id, approve);
  await db.auditLog.create({ data: { userId: user.id, action: "launcher.approve", params: { code, approve }, result: result === "ok" ? "OK" : "DENIED", detail: result } });
  redirect(`/launcher/${code}?done=${result}`);
}
