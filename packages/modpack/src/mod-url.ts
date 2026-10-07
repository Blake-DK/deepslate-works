// A file in the lock is fetched by Build on the VPS and by every PC, and the lock can be written by more than Lock
// (it lives in the repo the site can write). Modrinth's API only ever gives cdn.modrinth.com addresses, so anything
// else is a lock Lock did not write: refused in Lock before it is written, before Build fetches it, and by lint. The
// checksum travels in the same file as the address, so it cannot stand in for this check.
export const MOD_HOST = "cdn.modrinth.com";

/** Why this address may not be fetched, or null when it may. */
export function modUrlProblem(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `not an address: ${url}`;
  }
  if (u.protocol !== "https:" || u.hostname !== MOD_HOST) return `not on https://${MOD_HOST}: ${url}`;
  return null;
}
