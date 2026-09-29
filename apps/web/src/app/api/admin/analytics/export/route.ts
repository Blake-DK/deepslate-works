import { loadCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { audit } from "@/server/events";
import { rangeFor } from "@/lib/analytics";
import { csv } from "@/lib/event-query";

export const dynamic = "force-dynamic";

// Admin only: the sessions of a period as CSV, addresses included (docs/16 §2).
export async function GET(req: Request) {
  const user = await loadCurrentUser();
  if (!user || user.role !== "ADMIN") return Response.json({ error: { code: "forbidden", message: "admin only" } }, { status: 403 });
  const now = new Date();
  const first = await db.session.findFirst({ orderBy: { joinedAt: "asc" }, select: { joinedAt: true } });
  const range = rangeFor(new URL(req.url).searchParams.get("range") ?? undefined, now, first?.joinedAt ?? null);
  const rows = await db.session.findMany({ where: { joinedAt: { gte: range.from, lt: range.to } }, orderBy: { joinedAt: "asc" }, take: 100_000 });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId).filter((x): x is string => Boolean(x)))] } }, select: { id: true, displayName: true } });
  const name = new Map(users.map((u) => [u.id, u.displayName]));
  await audit({ userId: user.id, action: "analytics.export", params: { range: range.key, rows: rows.length }, result: "OK" });
  const body = csv(
    ["minecraft_name", "minecraft_uuid", "member", "joined_utc", "left_utc", "minutes", "country", "address"],
    rows.map((r) => [r.mcName, r.mcUuid, r.userId ? (name.get(r.userId) ?? "") : "", r.joinedAt, r.leftAt, Math.round(((r.leftAt ?? now).getTime() - r.joinedAt.getTime()) / 60_000), r.country, r.ip]),
  );
  return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="deepslate-sessions-${range.key}-${now.toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
}
