import { db } from "@/server/db";
import { env, missingEnv } from "@/env";

async function ampReachable(): Promise<"unconfigured" | "ok" | "unreachable"> {
  if (!env.AMP_URL) return "unconfigured";
  try {
    const res = await fetch(env.AMP_URL, { method: "GET", signal: AbortSignal.timeout(3000), cache: "no-store" });
    return res.status < 500 ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function GET() {
  let dbOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {}
  const amp = await ampReachable();
  const missing = missingEnv();
  const ok = dbOk && missing.length === 0;
  return Response.json({ ok, db: dbOk, amp, missingEnv: missing, discord: env.discordEnabled }, { status: ok ? 200 : 503 });
}
