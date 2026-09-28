import "server-only";
import { MC_USERNAME_RE } from "./auth/constants";

export function formatUuid(raw: string): string {
  const h = raw.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) throw new Error("Not a UUID");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type MojangLookup =
  | { ok: true; name: string; uuid: string }
  | { ok: false; reason: "invalid" | "not_found" | "unavailable" };

/** Resolves a Java Edition username to its UUID and canonical capitalisation. */
export async function lookupMinecraftUser(username: string): Promise<MojangLookup> {
  if (!MC_USERNAME_RE.test(username)) return { ok: false, reason: "invalid" };
  try {
    const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`, {
      signal: AbortSignal.timeout(6000),
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 404 || res.status === 204) return { ok: false, reason: "not_found" };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const body = (await res.json()) as { id?: string; name?: string };
    if (!body.id || !body.name) return { ok: false, reason: "not_found" };
    return { ok: true, name: body.name, uuid: formatUuid(body.id) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
