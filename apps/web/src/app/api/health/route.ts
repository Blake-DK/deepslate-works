import { db } from "@/server/db";
import { env, missingEnv } from "@/env";
import { apiFetch } from "@/server/api-client";
import { getPackDrift } from "@/server/modpack/drift";
import { driftHealth } from "@/lib/pack-drift";
import { loadCurrentUser } from "@/server/auth/session";
import { publicHealth } from "@/lib/health";

type ApiHealth = { ok: boolean; tunnel: string; amp: string; rsync: string; discordFeed?: "on" | "off" | "refused"; discordBot?: "on" | "off" | "refused" | "reconnecting" };

export async function GET(req: Request) {
  let dbOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {}
  let api: ApiHealth | { ok: false; error: string };
  try {
    api = await apiFetch<ApiHealth>("/health", { timeoutMs: 15_000 });
  } catch (e) {
    api = { ok: false, error: e instanceof Error ? e.message : "unreachable" };
  }
  // reported, not required: the server running a pack main does not have (docs/11, 2026-10-03)
  const pack = await getPackDrift().then(driftHealth).catch(() => null);
  const missing = missingEnv();
  const ok = dbOk && missing.length === 0;
  // `ok` is the web app's own health; the tunnel/AMP state is reported, not required (Phase 0 done-list tracks it).
  const full = { ok, db: dbOk, api, missingEnv: missing, discord: env.discordEnabled, guildGate: Boolean(env.DISCORD_GUILD_ID), pack };
  // docs/31 B-39: the names of what is wrong (tunnel, AMP, rsync, the bot, missing variables) are for admins. Anyone
  // else, a monitor included, gets yes or no for each part. A request that did not come through the proxy (the
  // container's own healthcheck, deploy.sh) gets everything: nothing outside can make one.
  const internal = !req.headers.get("x-forwarded-for") && !req.headers.get("x-forwarded-host");
  const admin = internal ? false : (await loadCurrentUser().catch(() => null))?.role === "ADMIN";
  return Response.json(internal || admin ? full : publicHealth(full), { status: ok ? 200 : 503 });
}
