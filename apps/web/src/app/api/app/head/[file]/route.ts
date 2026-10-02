import { loadCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { headFor } from "@/server/heads";
import { bearer, userFromLauncherToken } from "@/server/launcher";
import { headFile } from "@/lib/heads";

export const dynamic = "force-dynamic";

// docs/21 §7: GET /api/app/head/<uuid>.png, a member's 24 px head for the app's "who's online" (and for the site, signed
// in). Only the heads of members who linked their Minecraft account are fetched (docs/14); anyone else, and any
// failure, gets the grey placeholder, so the app always has a picture to show.
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const token = bearer(req);
  if (!(token ? await userFromLauncherToken(token) : await loadCurrentUser())) return new Response("Sign in first", { status: 401, headers: { "content-type": "text/plain; charset=utf-8" } });
  const uuid = headFile((await params).file);
  if (!uuid) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const member = await db.user.findUnique({ where: { mcUuid: uuid }, select: { id: true } });
  const head = await headFor(member ? uuid : null);
  return new Response(new Uint8Array(head.data), {
    headers: {
      "content-type": "image/png",
      "content-length": String(head.data.length),
      // a fetched head is good for the day; a placeholder only briefly, so the real one shows once it is there
      "cache-control": head.source === "placeholder" ? "private, max-age=60" : "private, max-age=3600",
      "x-head-source": head.source,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "same-origin",
    },
  });
}
