import { availability, type Amp, type AmpStatus, type Availability } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";

// docs/05 + docs/16 §1: one poll loop asks AMP for its status, keeps the latest answer in memory for
// `/status` (so a page view never costs an AMP call) and records ServerSnapshot rows for the charts.

export type LiveStatus = {
  state: string;
  stateCode: number | null;
  availability: Availability;
  players: string[];
  online: Array<{ name: string; uuid: string | null; ping: number | null }>;
  maxPlayers: number | null;
  cpu: number | null;
  memMb: number | null;
  memMaxMb: number | null;
  tps: number | null;
  uptime: string | null;
  at: string;
};

/** `pings`: by UUID where it is known, by "name:<name>" where not; null when nobody's ping is known. */
export type Snapshot = { at: Date; state: string; players: string[]; tps: number | null; cpu: number | null; memMb: number | null; pings: Record<string, number> | null };
export type SnapshotStore = {
  save(s: Snapshot): Promise<void>;
  /** Drops rows past `maxAgeDays` and thins rows older than `thinAfterHours` to one per five minutes. */
  prune(now: Date, maxAgeDays: number, thinAfterHours: number): Promise<{ deleted: number; thinned: number }>;
};

export const POLL_MS = 10_000;
const RUNNING_EVERY_MS = 15_000;
const IDLE_EVERY_MS = 5 * 60_000;
const PRUNE_EVERY_MS = 60 * 60_000;
export const FRESH_MS = 30_000;

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

/** Pure: is this poll worth a row? Always on a change; otherwise every 15 s while running, every 5 min while not. */
export function shouldSnapshot(prev: Pick<Snapshot, "at" | "state" | "players"> | null, next: Pick<Snapshot, "state" | "players">, now: Date, running: boolean): boolean {
  if (!prev) return true;
  if (prev.state !== next.state || !sameSet(prev.players, next.players)) return true;
  return now.getTime() - prev.at.getTime() >= (running ? RUNNING_EVERY_MS : IDLE_EVERY_MS) - 500;
}

export function toLive(s: AmpStatus, tail: Pick<ConsoleTail, "online" | "uuidByName"> | null, now: Date, pings: Record<string, number> = {}): LiveStatus {
  const running = s.stateCode === 20;
  // AMP's list lags the console by a few seconds either way; while running, anyone in either counts.
  const names = running ? [...new Set([...s.players, ...(tail?.online ?? [])])] : [];
  return {
    state: s.state,
    stateCode: s.stateCode ?? null,
    availability: availability(s.stateCode),
    players: names,
    online: names.map((name) => ({ name, uuid: tail?.uuidByName.get(name) ?? null, ping: pings[name] ?? null })),
    maxPlayers: s.maxPlayers ?? null,
    cpu: s.cpu,
    memMb: s.memMb,
    memMaxMb: s.memMaxMb ?? null,
    tps: s.tps ?? null,
    uptime: s.uptime,
    at: now.toISOString(),
  };
}

export class StatusPoller {
  latest: LiveStatus | null = null;
  lastError: string | null = null;
  /** The state name a snapshot row is saved with; docs/13 §12 saves "Waking" while a wake runs, so it counts as available. */
  stateName: ((live: LiveStatus) => string) | null = null;
  private lastSaved: Snapshot | null = null;
  private lastPrune = 0;
  private timer: NodeJS.Timeout | null = null;
  private listeners: Array<(next: LiveStatus, prev: LiveStatus | null) => void> = [];

  constructor(
    private readonly amp: Amp,
    private readonly tail: ConsoleTail | null,
    private readonly store: SnapshotStore | null,
    private readonly log: (o: unknown, msg: string) => void,
    private readonly now: () => Date = () => new Date(),
    private readonly pings: () => Record<string, number> = () => ({}),
  ) {}

  /** Called after every successful poll, with the previous answer (null on the first). */
  onStatus(fn: (next: LiveStatus, prev: LiveStatus | null) => void) {
    this.listeners.push(fn);
  }

  start() {
    const loop = async () => {
      await this.poll();
      this.timer = setTimeout(loop, POLL_MS);
    };
    void loop();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  /** The latest answer if it is recent enough to show, else null (the caller asks AMP itself). */
  fresh(): LiveStatus | null {
    return this.latest && this.now().getTime() - Date.parse(this.latest.at) < FRESH_MS ? this.latest : null;
  }

  async poll(): Promise<void> {
    const now = this.now();
    let live: LiveStatus;
    try {
      live = toLive(await this.amp.getStatus(), this.tail, now, this.pings());
      this.lastError = null;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.log({ err: this.lastError }, "status poll failed");
      return;
    }
    const prev = this.latest;
    this.latest = live;
    for (const fn of this.listeners) {
      try {
        fn(live, prev);
      } catch (err) {
        this.log({ err: String(err) }, "status listener failed");
      }
    }
    if (!this.store) return;
    const measured = live.online.filter((p) => p.ping !== null).map((p) => [p.uuid ?? `name:${p.name.toLowerCase()}`, p.ping as number] as const);
    const snap: Snapshot = { at: now, state: this.stateName?.(live) ?? live.state, players: live.players, tps: live.tps, cpu: live.cpu, memMb: live.memMb, pings: measured.length ? Object.fromEntries(measured) : null };
    try {
      if (shouldSnapshot(this.lastSaved, snap, now, live.stateCode === 20)) {
        await this.store.save(snap);
        this.lastSaved = snap;
      }
      if (now.getTime() - this.lastPrune >= PRUNE_EVERY_MS) {
        this.lastPrune = now.getTime();
        const r = await this.store.prune(now, 30, 48);
        if (r.deleted || r.thinned) this.log(r, "snapshots pruned");
      }
    } catch (e) {
      this.log({ err: String(e) }, "snapshot write failed");
    }
  }
}
