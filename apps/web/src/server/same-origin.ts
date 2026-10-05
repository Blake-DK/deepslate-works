import "server-only";

/**
 * True when the request says it comes from another site (docs/35 R-16): its Origin names a host that is not ours.
 * A browser sends Origin with every POST from a page, so a form or script elsewhere cannot post here with a
 * member's cookie. No Origin (curl, the app with its token) is not another site.
 */
export function fromAnotherSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true; // "null" and the like: not one of our pages
  }
}
