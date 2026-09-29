"use server";
import { redirect } from "next/navigation";
import { requireOnboardedUser } from "@/server/auth/session";
import { approveLauncherAuth } from "@/server/launcher";
import { normaliseInviteCode } from "@/server/auth/invite-codes";
import { audit } from "@/server/events";

// "approve" / "deny" is bound to each button (formAction), not sent as the button's name/value (see admin/server/actions.ts).
export async function decideLauncherAction(decision: string, formData: FormData) {
  const user = await requireOnboardedUser();
  const code = normaliseInviteCode(String(formData.get("code") ?? ""));
  const approve = decision === "approve";
  const result = await approveLauncherAuth(code, user.id, approve);
  await audit({ userId: user.id, action: "launcher.approve", params: { code, approve }, result: result === "ok" ? "OK" : "DENIED", detail: result });
  redirect(`/launcher/${code}?done=${result}`);
}
