import { db } from "../db.js";
import type { RouterDash, RouterLoginEvent } from "./client.js";

// Where game sessions came from (Alex, 2026-10-07). Behind mc-router the game server only sees a local address, so
// `Session.ip` and `Session.country` stayed empty and the analytics' Countries panel had nothing. mc-router's dashboard
// keeps each login with the player's real address: a session without an address is matched to the login of the same
// player, on the address players join Deepslate Works by, just before the server said they joined. The address and
// its country are then kept like any other (privacy `geo`, retention `ipDays`, docs/16).

export type OpenSession = { id: string; mcUuid: string; mcName: string; joinedAt: Date };
export type AddressStore = {
  /** Sessions since `since` that have no address yet. */
  unfilled(since: Date): Promise<OpenSession[]>;
  setAddress(id: string, ip: string, country: string | null): Promise<void>;
};

/** How long before "joined the game" mc-router may have passed the login on (mods load in between), and after. */
const BEFORE_MS = 5 * 60_000;
const AFTER_MS = 60_000;

const plainUuid = (u: string | null | undefined) => (u ?? "").toLowerCase().replace(/-/g, "");

/** The login a session came from: same player (by UUID, else by name), passed on, on `host` when known, closest in time. */
export function matchLogin(s: OpenSession, logins: RouterLoginEvent[], host: string | null): RouterLoginEvent | null {
  const uuid = plainUuid(s.mcUuid.startsWith("name:") ? null : s.mcUuid);
  const name = s.mcName.toLowerCase();
  const at = s.joinedAt.getTime();
  let best: RouterLoginEvent | null = null;
  let bestGap = Infinity;
  for (const l of logins) {
    if (!l.ok || !l.client) continue;
    if (host && l.server?.toLowerCase() !== host) continue;
    const same = uuid && l.uuid ? plainUuid(l.uuid) === uuid : l.player?.toLowerCase() === name;
    if (!same) continue;
    const t = Date.parse(l.at);
    if (t < at - BEFORE_MS || t > at + AFTER_MS) continue;
    const gap = Math.abs(at - t);
    if (gap < bestGap) { best = l; bestGap = gap; }
  }
  return best;
}

export const prismaAddressStore: AddressStore = {
  unfilled: (since) => db.session.findMany({ where: { ip: null, joinedAt: { gte: since } }, select: { id: true, mcUuid: true, mcName: true, joinedAt: true }, orderBy: { joinedAt: "asc" } }),
  setAddress: async (id, ip, country) => { await db.session.update({ where: { id }, data: { ip, country } }); },
};

/**
 * One pass: every session of the last `ipDays` without an address, against mc-router's logins from just before the
 * oldest of them. Returns how many were filled. Sessions that joined some other way (on the LAN, before the dashboard
 * existed) stay empty and are looked at again next time; that is a database query and one request.
 */
export async function fillAddresses(d: {
  dash: RouterDash; store: AddressStore; host: string | null; ipDays: number; geo: boolean;
  country: (ip: string) => Promise<string | null>; now?: Date;
}): Promise<number> {
  const now = d.now ?? new Date();
  const sessions = await d.store.unfilled(new Date(now.getTime() - d.ipDays * 86_400_000));
  if (sessions.length === 0) return 0;
  const logins = await d.dash.loginsSince(new Date(sessions[0]!.joinedAt.getTime() - BEFORE_MS));
  let filled = 0;
  for (const s of sessions) {
    const l = matchLogin(s, logins, d.host);
    if (!l?.client) continue;
    await d.store.setAddress(s.id, l.client, d.geo ? await d.country(l.client) : null);
    filled++;
  }
  return filled;
}
