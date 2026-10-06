import { loadCurrentUser } from "@/server/auth/session";
import { getPending } from "@/server/modpack/pending";
import { pendingHeadline } from "modpack/pending";

export const dynamic = "force-dynamic";

// Admin only: what Admin → Modpack's "out of date" box shows (server/modpack/pending.ts). Read-only; the box asks
// again every 20 s while it is on screen.
export async function GET() {
  const user = await loadCurrentUser();
  if (!user || user.role !== "ADMIN") return Response.json({ error: { code: "forbidden", message: "admin only" } }, { status: 403 });
  const p = await getPending();
  return Response.json({ ...p, headline: pendingHeadline(p), checkedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
