import "server-only";
import { db } from "@/server/db";
import { apiFetch } from "@/server/api-client";
import { fillBuckets, type Bucket } from "@/lib/series";
import { serverState, type ServerState } from "@/shared/server-state";

// What the dashboard shows. api keeps this fresh from AMP every 10 s; here it is cached for 5 s per process.

export type Availability = "online" | "starting" | "sleeping" | "offline" | "unknown";
export type WakeView = { phase: "idle" | "waking" | "ready" | "failed"; startedAt: string | null; endedAt: string | null; leftS: number | null; by: string | null };
export type LiveStatus = {
  state: string;
  stateCode: number | null;
  availability: Availability;
  /** docs/13 §12: the one state the whole site shows (shared/server-state.ts). */
  server: ServerState;
  /** why AMP can't be reached, for admins; null unless `server` is "unreachable" */
  reason: string | null;
  /** an empty running server goes to sleep in about this many minutes */
  sleepInMin: number | null;
  wake: WakeView;
  players: string[];
  online: Array<{ name: string; uuid: string | null; ping: number | null }>; // ping in ms, from the last round (docs/05 "Connection")
  maxPlayers: number | null;
  cpu: number | null;
  memMb: number | null;
  memMaxMb: number | null;
  tps: number | null;
  uptime: string | null;
  at: string;
};

const NO_WAKE: WakeView = { phase: "idle", startedAt: null, endedAt: null, leftS: null, by: null };

/** What the site knows when it cannot ask: nothing, and it says so ("Can't reach the server"), never "offline". */
export function unreachableStatus(reason: string): LiveStatus {
  return { state: "Unknown", stateCode: null, availability: "unknown", server: "unreachable", reason, sleepInMin: null, wake: NO_WAKE, players: [], online: [], maxPlayers: null, cpu: null, memMb: null, memMaxMb: null, tps: null, uptime: null, at: new Date().toISOString() };
}

let cache: { at: number; value: LiveStatus } | null = null;

/** The server's status as api last saw it. Never null: when api itself does not answer, that is "unreachable" too. */
export async function getStatus(): Promise<LiveStatus> {
  if (cache && Date.now() - cache.at < 5000) return cache.value;
  let value: LiveStatus;
  try {
    const s = await apiFetch<Partial<LiveStatus> & { state: string }>("/status", { timeoutMs: 5000 });
    value = {
      state: s.state,
      stateCode: s.stateCode ?? null,
      // an older api answers without `availability`: fall back to the state name
      availability: s.availability ?? (/^running$/i.test(s.state) ? "online" : "offline"),
      players: s.players ?? [],
      online: (s.online ?? (s.players ?? []).map((name) => ({ name, uuid: null, ping: null }))).map((p) => ({ name: p.name, uuid: p.uuid ?? null, ping: typeof p.ping === "number" ? p.ping : null })),
      maxPlayers: s.maxPlayers ?? null,
      cpu: s.cpu ?? null,
      memMb: s.memMb ?? null,
      memMaxMb: s.memMaxMb ?? null,
      tps: s.tps ?? null,
      uptime: s.uptime ?? null,
      at: s.at ?? new Date().toISOString(),
      // an api from before docs/13 §12 sends no `server`: work it out the same way from the state number
      server: s.server ?? serverState({ stateCode: s.stateCode ?? null, reachable: true, waking: false, crashed: false }),
      reason: s.reason ?? null,
      sleepInMin: typeof s.sleepInMin === "number" ? s.sleepInMin : null,
      wake: s.wake ?? NO_WAKE,
    };
  } catch {
    value = unreachableStatus("the site's backend (api) isn't answering");
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
