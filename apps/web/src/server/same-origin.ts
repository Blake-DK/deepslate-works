import "server-only";

/**
 * True when the request says it comes from another site (docs/35 R-16): its Origin names a host that is not ours.
 * A browser sends Origin with every POST from a page, so a form or script elsewhere cannot post here with a
 * member's cookie. No Origin (curl, the app with its token) is not another site.
 */
export function fromAnotherSite(req: Request): boolean {
  return originIsForeign(req.headers.get("origin"), req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
}

/** The same check on an Origin and Host already read, for server actions (headers() rather than a Request). */
export function originIsForeign(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true; // "null" and the like: not one of our pages
  }
}
