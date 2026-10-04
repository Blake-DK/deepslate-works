import { loadCurrentUser } from "@/server/auth/session";
import { bearer, userFromLauncherToken } from "@/server/launcher";
import { getSeasonCurrent, lineFor } from "@/server/season";

export const dynamic = "force-dynamic";

// docs/20 §7, docs/34 §5: the current season in a few words, for members (the site's session) and for the app (its
// token). Weeks and days are worked out here, so the app shows the same words as Home. `line` is that sentence.
export async function GET(req: Request) {
  const token = bearer(req);
  const user = (token ? await userFromLauncherToken(token) : null) ?? (await loadCurrentUser().catch(() => null));
  if (!user) return Response.json({ error: { code: "unauthorized", message: "Sign in first." } }, { status: 401, headers: { "cache-control": "no-store" } });
  const current = await getSeasonCurrent();
  return Response.json({ ...current, line: lineFor(current) }, { headers: { "cache-control": "no-store" } });
}
