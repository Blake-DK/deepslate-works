import { loadCurrentUser } from "@/server/auth/session";
import { getStatus } from "@/server/status";
import { statusText } from "@/lib/server-status";
import { forViewer, getVersions } from "@/server/versions";

// Every version in one place, the same values the footers show (planner, 2026-10-01): the portal (web and api),
// the app, the pack, the server's Minecraft and NeoForge, and the server's state in the site's words. Public: the
// app reads it before anyone signs in. Commits, build and deploy times only for an admin's session.
export async function GET() {
  const [v, user, status] = await Promise.all([getVersions(), loadCurrentUser().catch(() => null), getStatus().catch(() => null)]);
  const admin = user?.role === "ADMIN";
  return Response.json({ ...forViewer(v, admin), status: status ? statusText(status, false).line : null }, { headers: { "cache-control": "no-store" } });
}
