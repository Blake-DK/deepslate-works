// docs/04: Authentik's sign-in page for this site draws its text in the site's pixel font, loaded from /brand/fonts/
// on another origin. Browsers allow that only with Access-Control-Allow-Origin. The one origin let in is Authentik's,
// read from AUTHENTIK_ISSUER at run time; without it there is no header, as before. Edge-safe: used by the middleware.

export const FONT_PATH = /^\/brand\/fonts\/[A-Za-z-]+\.(ttf|txt)$/;

/** The origin that may load the fonts (the issuer's, https only), or null. */
export function fontOrigin(issuer: string): string | null {
  try {
    const u = new URL(issuer);
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}
