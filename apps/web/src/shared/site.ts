// SHARED FILE: apps/web/src/shared/ and apps/api/src/shared/ hold identical copies (a test compares them).
// Edit the copy in apps/web, then `cp apps/web/src/shared/*.ts apps/api/src/shared/`.
//
// The site's host, for text players read in the game ("press Play on …"). It comes from PORTAL_URL (api) or
// AUTH_URL (web) in deploy/.env, so the real address is never in the repository; the fallback is a placeholder.
// Undefined in the browser: client code names the page instead ("the Install page").
const url = (typeof process === "undefined" ? undefined : process.env.PORTAL_URL ?? process.env.AUTH_URL) ?? "https://deepslate.dsw.test";
export const SITE_HOST = url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
