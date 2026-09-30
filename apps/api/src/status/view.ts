import type { LiveStatus, StatusPoller } from "./poller.js";
import type { Wake, WakeView } from "./wake.js";
import { serverState, type ServerState } from "../shared/server-state.js";

// docs/13 §12 A: what /status adds to AMP's own answer, so the site can say how the server is in one set of words.

export type Reason = "login refused" | "tunnel down" | "instance not running" | "AMP not answering";
export type StatusExtra = { server: ServerState; reason: Reason | null; sleepInMin: number | null; wake: WakeView };

/** Why AMP could not be reached, from the error the poll got and whether the tunnel carries traffic. */
export function reasonFor(error: string | null, tunnelUp: boolean | null): Reason {
  if (tunnelUp === false) return "tunnel down";
  if (error && /login failed/i.test(error)) return "login refused";
  if (error && /(instance|not running|unavailable|\b50[23]\b|ECONNREFUSED)/i.test(error)) return "instance not running";
  return "AMP not answering";
}

/** Minutes until AMP puts an empty server to sleep; null when it is not empty, or sleep is off or unknown. */
export function sleepIn(d: { running: boolean; players: number; emptySince: number | null; sleepOn: boolean | null; delayMin: number | null; now: number }): number | null {
  if (!d.running || d.players > 0 || d.emptySince === null || d.sleepOn !== true || d.delayMin === null) return null;
  return Math.max(1, d.delayMin - (d.now - d.emptySince) / 60_000);
}

export type ViewDeps = {
  poller: Pick<StatusPoller, "fresh" | "lastError">;
  wake: Wake;
  /** the recorder's last word on how the server went down */
  lastDown: () => "crash" | "stop" | "sleep" | "restart" | null;
  sleep: () => { on: boolean | null; delayMin: number | null };
  tunnelUp: () => boolean | null;
  now?: () => number;
};

/** Keeps what only the portal knows next to AMP's status: when the server became empty, whether it can be reached. */
export class ServerView {
  private emptySince: number | null = null;
  constructor(private readonly d: ViewDeps) {}

  private now() {
    return (this.d.now ?? Date.now)();
  }

  /** From the status poller, on every answer. */
  observe(next: LiveStatus) {
    const empty = next.stateCode === 20 && next.players.length === 0;
    if (!empty) this.emptySince = null;
    else this.emptySince ??= this.now();
  }

  extra(live: LiveStatus | null): StatusExtra {
    const reachable = live !== null;
    const s = serverState({ stateCode: live?.stateCode ?? null, reachable, waking: this.d.wake.waking, crashed: this.d.lastDown() === "crash" });
    const sleep = this.d.sleep();
    return {
      server: s,
      reason: s === "unreachable" ? reasonFor(this.d.poller.lastError, this.d.tunnelUp()) : null,
      sleepInMin: live ? sleepIn({ running: live.stateCode === 20, players: live.players.length, emptySince: this.emptySince, sleepOn: sleep.on, delayMin: sleep.delayMin, now: this.now() }) : null,
      wake: this.d.wake.view(),
    };
  }

  /** The state right now, from the poller's last fresh answer. */
  state(): ServerState {
    return this.extra(this.d.poller.fresh()).server;
  }
}
