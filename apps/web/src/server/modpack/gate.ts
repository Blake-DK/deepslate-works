import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getStatus } from "@/server/status";
import { downloadsOpen } from "@/lib/gate-rule";
import { env } from "@/env";
import { getSettings } from "@/server/settings";

// Who may download the pack (Alex's rule): admins always; players only while the Minecraft server is
// available (running, or asleep and ready to wake: decided 2026-09-29) and the site is connected to it;
// nobody anonymous. Starting, stopped, failed or out of reach all mean no.

export async function serverOnline(): Promise<boolean> {
  return downloadsOpen((await getStatus())?.availability); // getStatus caches for 5 s
}

export async function canDownload(user: { role: "ADMIN" | "PLAYER" } | null): Promise<{ ok: boolean; reason: "admin" | "online" | "offline" | "anonymous" | "not_live" }> {
  if (!user) return { ok: false, reason: "anonymous" };
  if (user.role === "ADMIN") return { ok: true, reason: "admin" };
  if (!(await getSettings()).live) return { ok: false, reason: "not_live" };
  return (await serverOnline()) ? { ok: true, reason: "online" } : { ok: false, reason: "offline" };
}

export function manifestKeyOk(given: string | null): boolean {
  if (!given || !env.MANIFEST_KEY) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(env.MANIFEST_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}
