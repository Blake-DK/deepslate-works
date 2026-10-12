import { PRIVATE_PATH, privateJarOf } from "modpack/mod-url";

// docs/58: the lock holds only a private jar's path (/downloads/mods/<filename>); the address the app is given is made
// on the site's own AUTH_URL, never taken from the lock.

/** The address the app is given for a lock file: a private jar's path on `site`; anything else as the lock has it. */
export function fileUrl(url: string, site: string): string {
  return privateJarOf(url) ? `${site.replace(/\/+$/, "")}${url}` : url;
}

/**
 * The same for the test pack (docs/45): a private jar of the test server's is fetched through this (live) site, which
 * passes it on from the test server's api: /downloads/mods/test/<filename>. The test server's jar never sits on live.
 */
export function testFileUrl(url: string, site: string): string {
  const name = privateJarOf(url);
  return name ? `${site.replace(/\/+$/, "")}${PRIVATE_PATH}test/${name}` : url;
}
