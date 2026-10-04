"use server";
import { redirect } from "next/navigation";
import { requireOnboardedUser } from "@/server/auth/session";
import { linkWithCode } from "@/server/link";
import { readCode } from "@/shared/join-code";

/**
 * The "Yes, link" button on /link/<code> and /join (docs/31 B-06). The only place a Minecraft account is linked.
 * Afterwards the same page is shown again by GET: `done` says what to tell them (1 let out, 2 linked and still
 * in the room); a refusal needs no flag, the page works it out again from the code.
 */
export async function confirmLinkAction(formData: FormData) {
  const code = readCode(String(formData.get("code") ?? ""));
  const via = formData.get("via") === "join" ? "join" : "link";
  const here = via === "join" ? `/join?code=${code}` : `/link/${code}`;
  const user = await requireOnboardedUser(here);
  const outcome = await linkWithCode(user, code, via);
  if (outcome.tone !== "success") redirect(here);
  const released = outcome.text.startsWith("You're through");
  redirect(`${here}${via === "join" ? "&" : "?"}done=${released ? 1 : 2}`);
}
