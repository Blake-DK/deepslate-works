import "server-only";
import { db } from "@/server/db";
import { apiFetch } from "@/server/api-client";
import { fillBuckets, type Bucket } from "@/lib/series";

// What the dashboard shows. api keeps this fresh from AMP every 10 s; here it is cached for 5 s per process.

export type Availability = "online" | "starting" | "sleeping" | "offline" | "unknown";
export type LiveStatus = {
  state: string;
  stateCode: number | null;
  availability: Availability;
  players: string[];
  online: Array<{ name: string; uuid: string | null }>;
  maxPlayers: number | null;
  cpu: number | null;
  memMb: number | null;
  memMaxMb: number | null;
  tps: number | null;
  uptime: string | null;
  at: string;
};

export const AVAILABILITY_TEXT: Record<Availability, { label: string; tone: "good" | "warn" | "bad" | "neutral"; hint: string }> = {
  online: { label: "Online", tone: "good", hint: "The server is up." },
  starting: { label: "Starting", tone: "warn", hint: "The server is starting up. Give it a minute or two." },
  sleeping: { label: "Asleep", tone: "neutral", hint: "Nobody is on, so the server is asleep. It wakes up when someone joins; the first join takes a little longer." },
  offline: { label: "Offline", tone: "bad", hint: "The server is switched off." },
  unknown: { label: "Unknown", tone: "neutral", hint: "The site can't reach the server's control panel right now." },
};

let cache: { at: number; value: LiveStatus | null } | null = null;

export async function getStatus(): Promise<LiveStatus | null> {
  if (cache && Date.now() - cache.at < 5000) return cache.value;
  let value: LiveStatus | null = null;
  try {
    const s = await apiFetch<Partial<LiveStatus> & { state: string }>("/status", { timeoutMs: 5000 });
    value = {
      state: s.state,
      stateCode: s.stateCode ?? null,
      // an older api answers without `availability`: fall back to the state name
      availability: s.availability ?? (/^running$/i.test(s.state) ? "online" : "offline"),
      players: s.players ?? [],
      online: s.online ?? (s.players ?? []).map((name) => ({ name, uuid: null })),
      maxPlayers: s.maxPlayers ?? null,
      cpu: s.cpu ?? null,
      memMb: s.memMb ?? null,
      memMaxMb: s.memMaxMb ?? null,
      tps: s.tps ?? null,
      uptime: s.uptime ?? null,
      at: s.at ?? new Date().toISOString(),
    };
  } catch {
    value = null;
  }
  cache = { at: Date.now(), value };
  return value;
}

/** Most players online at once, per half hour, for the last 24 hours (48 slots, null where nothing was recorded). */
export async function playersLast24h(now: Date = new Date()): Promise<Array<number | null>> {
  const size = 1800;
  const since = new Date(now.getTime() - 24 * 3600_000);
  const rows = await db.$queryRaw<Array<{ bucket: number; value: number }>>`
    SELECT floor(extract(epoch FROM at) / ${size})::int AS bucket, max(cardinality(players))::int AS value
    FROM "ServerSnapshot" WHERE at >= ${since} GROUP BY 1 ORDER BY 1`;
  return fillBuckets(rows.map((r): Bucket => ({ bucket: Number(r.bucket), value: Number(r.value) })), now, size, 48);
}
