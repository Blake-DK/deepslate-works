// A file in the lock is fetched by Build (in api) and by every PC, and the lock can be written by more than Lock
// (it lives in the repo the site can write). Modrinth's API only ever gives cdn.modrinth.com addresses, so anything
// else is a lock Lock did not write: refused in Lock before it is written, before Build fetches it, and by lint. The
// checksum travels in the same file as the address, so it cannot stand in for this check.
//
// docs/58: one more place, the site itself, for a jar that is never published (a patched mod). The lock holds only its
// path, /downloads/mods/<filename>, never a host: each site hands it out from its own address (AUTH_URL), and Build
// copies it from the stack's data/private-jars/ without fetching anything.
export const MOD_HOST = "cdn.modrinth.com";
export const PRIVATE_PATH = "/downloads/mods/";
/** A private jar's file name: one plain name, no folders. */
export const PRIVATE_JAR = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,150}\.jar$/;

/** The lock's address for a private jar: on the site that hands out the lock, whichever that is. */
export const privateUrl = (filename: string) => `${PRIVATE_PATH}${filename}`;

/** The jar's file name when `url` is a private jar's address as the lock holds it; null for anything else. */
export function privateJarOf(url: string): string | null {
  if (!url.startsWith(PRIVATE_PATH)) return null;
  const name = url.slice(PRIVATE_PATH.length);
  return PRIVATE_JAR.test(name) && !name.includes("..") ? name : null;
}

/**
 * Why this address may not be fetched, or null when it may. `site` (AUTH_URL, never the lock's word) also lets
 * through that site's own /downloads/mods/<filename>, as the manifest hands a private jar to the app.
 */
export function modUrlProblem(url: string, site?: string | null): string | null {
  if (privateJarOf(url)) return null;
  const why = `not on https://${MOD_HOST} or this site's ${PRIVATE_PATH}: ${url}`;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `not an address: ${url}`;
  }
  if (u.protocol === "https:" && u.hostname === MOD_HOST) return null;
  if (site && sitePrivateJar(url, site)) return null;
  return why;
}

/** The jar's file name when `url` is `site`'s own /downloads/mods/<filename> (nothing after it); else null. */
export function sitePrivateJar(url: string, site: string): string | null {
  let u: URL, s: URL;
  try {
    u = new URL(url);
    s = new URL(site);
  } catch {
    return null;
  }
  if (u.origin !== s.origin || u.username || u.password || u.search || u.hash) return null;
  return privateJarOf(u.pathname);
}
