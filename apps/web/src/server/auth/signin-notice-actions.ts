"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import { actionFromAnotherSite } from "@/server/auth/request";
import { acknowledgeNotice } from "./signin-notice-core";
import { noticeDeps } from "./signin-notice";

/** "That was me" / "Seen it" on the admin sign-in notice: this admin has seen the sign-ins up to the newest one shown. */
export async function seenSignInNoticeAction(formData: FormData) {
  const admin = await requireAdmin();
  const shown = formData.get("shown");
  await acknowledgeNotice({ viewer: admin, foreign: await actionFromAnotherSite(), shown: typeof shown === "string" ? shown : "" }, noticeDeps);
  revalidatePath("/", "layout");
}
