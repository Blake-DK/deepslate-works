import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { Reader, type CountryResponse } from "mmdb-lib";

// docs/16 §1: the country of a player's address, from a database file on this host. No request leaves
// the machine. The file is MaxMind's GeoLite2-Country, kept current by the geoipupdate container.

let reader: Reader<CountryResponse> | null = null;
let loadedAt = 0;
let failedAt = 0;
const RELOAD_MS = 24 * 3600_000;

export function isPrivate(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

export async function countryOf(ip: string | null, file: string | undefined): Promise<string | null> {
  if (!ip || !file || isIP(ip) === 0 || isPrivate(ip)) return null;
  const now = Date.now();
  if ((!reader || now - loadedAt > RELOAD_MS) && now - failedAt > 10 * 60_000) {
    try {
      reader = new Reader<CountryResponse>(await readFile(file));
      loadedAt = now;
    } catch {
      failedAt = now;
    }
  }
  try {
    return reader?.get(ip)?.country?.iso_code ?? null;
  } catch {
    return null;
  }
}
