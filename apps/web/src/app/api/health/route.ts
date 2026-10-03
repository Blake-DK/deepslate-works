import { db } from "@/server/db";
import { env, missingEnv } from "@/env";
import { apiFetch } from "@/server/api-client";
import { getPackDrift } from "@/server/modpack/drift";
import { driftHealth } from "@/lib/pack-drift";

type ApiHealth = { ok: boolean; tunnel: string; amp: string; rsync: string; discordFeed?: "on" | "off" | "refused"; discordBot?: "on" | "off" | "refused" | "reconnecting" };

export async function GET() {
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
  return Response.json({ ok, db: dbOk, api, missingEnv: missing, discord: env.discordEnabled, guildGate: Boolean(env.DISCORD_GUILD_ID), pack }, { status: ok ? 200 : 503 });
}
