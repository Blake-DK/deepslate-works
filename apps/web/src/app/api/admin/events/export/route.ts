import type { Prisma } from "@prisma/client";
import { loadCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { audit } from "@/server/events";
import { actorsFor } from "@/server/event-log";
import { csv, eventWhere, readFilter } from "@/lib/event-query";

export const dynamic = "force-dynamic";
const MAX_ROWS = 50_000;

// Admin only: the event log for the current filter as CSV (docs/16 §4).
export async function GET(req: Request) {
  const user = await loadCurrentUser();
  if (!user || user.role !== "ADMIN") return Response.json({ error: { code: "forbidden", message: "admin only" } }, { status: 403 });
  const url = new URL(req.url);
  const q: Record<string, string | string[]> = {};
  for (const k of new Set(url.searchParams.keys())) q[k] = url.searchParams.getAll(k);
  const filter = { ...readFilter(q, true), before: null };
  const actors = filter.player ? await actorsFor(filter.player) : null;
  const rows = await db.event.findMany({ where: eventWhere(filter, true, actors) as Prisma.EventWhereInput, orderBy: { id: "desc" }, take: MAX_ROWS });
  await audit({ userId: user.id, action: "events.export", params: { rows: rows.length, kinds: filter.kinds, player: filter.player, from: filter.from, to: filter.to, text: filter.text }, result: "OK" });
  const body = csv(["id", "time_utc", "kind", "actor", "message", "count", "raw", "meta"], rows.map((r) => [r.id.toString(), r.at, r.kind, r.actor, r.message, r.count, r.raw, r.meta]));
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="deepslate-events-${stamp}.csv"`, "cache-control": "no-store" } });
}
