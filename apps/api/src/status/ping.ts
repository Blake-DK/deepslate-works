import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import { runAction } from "../actions/run.js";
import type { ActionCtx } from "../actions/registry.js";

// docs/05 "Connection": every 15 s, while somebody is on, the server is asked for everyone's ping (TabTPS'
// `pingall`, ten players to a page). The answer comes back as console lines, which the console tail reads.

export const PING_EVERY_MS = 15_000;
export const PING_STALE_MS = 50_000; // three rounds missed: the number is no longer shown
const PER_PAGE = 10;

export type Ping = { ms: number; at: number };

/** Pure: which pages to ask for. */
export function pagesFor(players: number): number[] {
  return Array.from({ length: Math.ceil(Math.max(0, players) / PER_PAGE) }, (_, i) => i + 1);
}

/** Pure: the pings that are recent enough to show, for the players who are still here. */
export function currentPings(all: ReadonlyMap<string, Ping>, online: Iterable<string>, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of online) {
    const p = all.get(name);
    if (p && now - p.at <= PING_STALE_MS) out[name] = p.ms;
  }
  return out;
}

export class PingWatch {
  private readonly pings = new Map<string, Ping>();
  private timer: NodeJS.Timeout | null = null;
  private failed = false;

  constructor(
    private readonly amp: Amp,
    private readonly tail: ConsoleTail,
    private readonly ctx: () => ActionCtx,
    private readonly log: (o: unknown, m: string) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  start() {
    this.tail.on((e, info) => {
      if (info.replay) return;
      if (e.type === "ping") this.pings.set(e.name, { ms: e.ms, at: this.now() });
      if (e.type === "leave") this.pings.delete(e.name);
    });
    this.timer = setInterval(() => void this.ask().catch((err) => this.log({ err: String(err) }, "ping round failed")), PING_EVERY_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** By player name. */
  current(): Record<string, number> {
    return currentPings(this.pings, this.tail.online, this.now());
  }

  async ask() {
    // Never to a server that is asleep or starting, and never to an empty one: there is nothing to measure.
    if (this.tail.state !== 20 || this.tail.online.size === 0) return;
    for (const page of pagesFor(this.tail.online.size)) {
      const r = await runAction(this.amp, this.ctx(), "server.pings", { page }, null);
      if (!r.ok && !this.failed) this.log({ detail: r.detail }, "could not ask for pings");
      this.failed = !r.ok;
      if (!r.ok) return;
    }
  }
}
