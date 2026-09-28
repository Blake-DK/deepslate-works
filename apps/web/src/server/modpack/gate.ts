import "server-only";
import { timingSafeEqual } from "node:crypto";
import { apiFetch } from "@/server/api-client";
import { env } from "@/env";
import { getSettings } from "@/server/settings";

// Who may download the pack (Alex's rule): admins always; players only while the Minecraft server is
// up and the site is connected to it; nobody anonymous. The Windows installer fetches the manifest
// with the private key stamped into it at build time.

type Status = { state: string };
let cache: { at: number; online: boolean } | null = null;

export async function serverOnline(): Promise<boolean> {
  if (cache && Date.now() - cache.at < 15_000) return cache.online;
  let online = false;
  try {
    const s = await apiFetch<Status>("/status", { timeoutMs: 5000 });
    online = /^running$/i.test(s.state);
  } catch {
    online = false;
  }
  cache = { at: Date.now(), online };
  return online;
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
