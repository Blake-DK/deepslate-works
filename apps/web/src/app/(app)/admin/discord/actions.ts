"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import { getSection, setSection } from "@/server/site-settings";
import { apiFetch, ApiError } from "@/server/api-client";
import { audit } from "@/server/events";
import { BOT_SWITCHES, SWITCHES } from "./switches";

// docs/21 §7: Admin → Site settings → Discord. web only stores the switches and asks api for a test line; api posts.
const BACK = "/admin/site?tab=discord";

export async function saveDiscordAction(formData: FormData) {
  const admin = await requireAdmin();
  const current = await getSection("discord");
  const next = { ...current, ...Object.fromEntries(SWITCHES.map((s) => [s.key, formData.get(s.key) === "on"])) };
  const r = await setSection("discord", next, admin.id);
  await audit({ userId: admin.id, action: "discord.settings", params: r.ok ? { value: r.value } : { problems: r.problems }, result: r.ok ? "OK" : "DENIED" });
  revalidatePath("/admin/site");
  redirect(r.ok ? `${BACK}&saved=discord` : `${BACK}&error=discord&detail=${encodeURIComponent(r.problems.join("; ").slice(0, 300))}`);
}

/** docs/22 §7: the bot's switches and the two channels picked from the server's own lists. */
export async function saveDiscordBotAction(formData: FormData) {
  const admin = await requireAdmin();
  const current = await getSection("discord");
  const id = (k: string) => String(formData.get(k) ?? "").trim();
  const next = { ...current, ...Object.fromEntries(BOT_SWITCHES.map((s) => [s.key, formData.get(s.key) === "on"])), chatChannel: id("chatChannel"), updatesForum: id("updatesForum") };
  const r = await setSection("discord", next, admin.id);
  await audit({ userId: admin.id, action: "discord.settings", params: r.ok ? { value: r.value } : { problems: r.problems }, result: r.ok ? "OK" : "DENIED" });
  revalidatePath("/admin/site");
  redirect(r.ok ? `${BACK}&saved=discord` : `${BACK}&error=discord&detail=${encodeURIComponent(r.problems.join("; ").slice(0, 300))}`);
}

/** Pause: nothing is posted and nothing is queued; switching it back on does not replay what happened meanwhile. */
export async function pauseDiscordAction(paused: boolean) {
  const admin = await requireAdmin();
  const current = await getSection("discord");
  const r = await setSection("discord", { ...current, paused }, admin.id);
  await audit({ userId: admin.id, action: "discord.settings", params: { paused, wasPaused: current.paused }, result: r.ok ? "OK" : "DENIED" });
  revalidatePath("/admin/site");
  redirect(`${BACK}&saved=${paused ? "paused" : "resumed"}`);
}

export async function testDiscordAction(channel: "feed" | "admin" | "updates") {
  const admin = await requireAdmin();
  let res: { ok: boolean; error?: string };
  try {
    res = await apiFetch<{ ok: boolean; error?: string }>("/discord/test", { method: "POST", body: { channel }, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 30_000 });
  } catch (e) {
    res = { ok: false, error: e instanceof ApiError ? e.message : "the portal's back end did not answer" };
  }
  await audit({ userId: admin.id, action: "discord.test", params: { channel, ok: res.ok, ...(res.error ? { error: res.error.slice(0, 200) } : {}) }, result: res.ok ? "OK" : "FAILED" });
  redirect(res.ok ? `${BACK}&tested=${channel}` : `${BACK}&testError=${encodeURIComponent((res.error ?? "not taken").slice(0, 200))}`);
}
