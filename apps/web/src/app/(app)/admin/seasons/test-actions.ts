"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { apiFetch, ApiError } from "@/server/api-client";
import { env } from "@/env";
import { ukLocalToDate } from "@/lib/uk-time";

// docs/42 §7: the test server's season tools. Only on the test site (TEST_MODE); api-test refuses them anywhere else
// too. Which button was pressed travels as a bound argument; the quick buttons send the instant api-test worked out.

const to = (msg: string, detail?: string) => `/admin/seasons?msg=${msg}${detail ? `&detail=${encodeURIComponent(detail)}` : ""}`;
const QUICK = z.string().datetime();

async function call(path: string, body: object, adminId: string) {
  try {
    await apiFetch(path, { method: "POST", body, caller: { id: adminId, role: "ADMIN" }, timeoutMs: 30_000 });
  } catch (e) {
    if (e instanceof ApiError) redirect(to("error", e.message));
    throw e;
  }
  revalidatePath("/", "layout"); // the stripe, the Season page and Home all show the clock
}

/** "Pretend it is" a UK date and time (`set`), a quick button's instant (`quick:<iso>`), or "Back to the real time". */
export async function testClockAction(which: string, formData: FormData) {
  const admin = await requireAdmin();
  if (!env.TEST_MODE) redirect(to("error", "Only the test site has a test clock"));
  if (which === "clear") {
    await call("/test/clock", { clear: true }, admin.id);
    redirect(to("clockCleared"));
  }
  let at: Date | null = null;
  if (which === "set") at = ukLocalToDate(String(formData.get("at") ?? ""));
  else if (which.startsWith("quick:") && QUICK.safeParse(which.slice(6)).success) at = new Date(which.slice(6));
  if (!at) redirect(to("error", "A date and a time, UK"));
  await call("/test/clock", { at: at.toISOString() }, admin.id);
  redirect(to("clockSet"));
}

/** Reset the season test (§7.2), behind a box that names the season. */
export async function testResetAction(season: string, formData: FormData) {
  const admin = await requireAdmin();
  if (!env.TEST_MODE) redirect(to("error", "Only the test site resets a season"));
  if (formData.get("sure") !== "on") redirect(to("confirm"));
  if (!/^[a-z0-9_]{1,32}$/.test(season)) redirect(to("error", "No such season"));
  await call("/test/season-reset", { season }, admin.id);
  redirect(to("reset"));
}

/** docs/42 T8: the door's three rules on the test server, each on or off. */
export async function testDoorAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!env.TEST_MODE) redirect("/admin/joining");
  const on = (k: string) => formData.get(k) === "on";
  try {
    await apiFetch("/test/door", { method: "POST", body: { playFirst: on("playFirst"), mustVote: on("mustVote"), newestApp: on("newestApp") }, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 15_000 });
  } catch (e) {
    if (e instanceof ApiError) redirect(`/admin/joining?msg=error&detail=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/admin/joining");
  redirect("/admin/joining?msg=testDoor");
}
