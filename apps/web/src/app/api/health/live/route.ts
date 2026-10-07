import { db } from "@/server/db";
import { missingEnv } from "@/env";

// What Docker's healthcheck calls (deploy/docker-compose.yml): web itself and its database, nothing it would have to
// wait on. On 2026-10-07 the first deploy of the build designer stopped at "deepslate-web is unhealthy" because
// /api/health waited on a designer that had not been started (and on api). /api/health keeps the detail for admins
// and deploy.sh; this answers yes or no within two seconds, whatever else is down.
const DB_LIMIT_MS = 1_500;

export async function GET() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dbOk = await Promise.race([
    db.$queryRaw`SELECT 1`.then(() => true, () => false),
    new Promise<boolean>((done) => {
      timer = setTimeout(() => done(false), DB_LIMIT_MS);
    }),
  ]);
  clearTimeout(timer);
  const ok = dbOk && missingEnv().length === 0;
  return Response.json({ ok }, { status: ok ? 200 : 503 });
}
