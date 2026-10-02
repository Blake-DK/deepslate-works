import { db } from "@/server/db";
import { env, missingEnv } from "@/env";
import { apiFetch } from "@/server/api-client";

type ApiHealth = { ok: boolean; tunnel: string; amp: string; rsync: string; discordFeed?: "on" | "off" | "refused" };

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
  const missing = missingEnv();
  const ok = dbOk && missing.length === 0;
  // `ok` is the web app's own health; the tunnel/AMP state is reported, not required (Phase 0 done-list tracks it).
  return Response.json({ ok, db: dbOk, api, missingEnv: missing, discord: env.discordEnabled, guildGate: Boolean(env.DISCORD_GUILD_ID) }, { status: ok ? 200 : 503 });
}
