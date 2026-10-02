import type { Amp } from "../amp/client.js";
import { WAKE_EXPECT_S, WAKE_TIMEOUT_MS } from "../shared/server-state.js";

// docs/13 §12 B: a member pressed Play and the server was asleep. One start is sent to AMP; a second Play while it
// runs sends nothing (the debounce); if AMP does not report Running within three minutes the wake has failed.
// Never a loop and never on its own: a wake starts only from a Play (routes/wake.ts), and only from Asleep.

export type WakePhase = "idle" | "waking" | "ready" | "failed";
export type WakeView = { phase: WakePhase; startedAt: string | null; endedAt: string | null; leftS: number | null; by: string | null };
type Audit = (a: { userId: string | null; action: string; params: Record<string, unknown>; result: string; detail?: string | null }) => Promise<unknown>;

/** How long "Server ready" or the failure stays on the Play page after the wake ended. */
const SHOW_END_MS = 10 * 60_000;

export class Wake {
  phase: WakePhase = "idle";
  private startedAt = 0;
  private endedAt = 0;
  private by: { userId: string; name: string } | null = null;

  constructor(private readonly amp: Amp, private readonly audit: Audit, private readonly now: () => number = Date.now) {}

  get waking(): boolean {
    return this.phase === "waking";
  }

  /** Sends the one start. The caller has decided (shared/server-state.ts `wakeDecision`) that it is "start". */
  /** `via`: "app" when Deepslate Works asked (planner 2026-10-02, the app as the front door), else the site's Play. */
  async start(userId: string, name: string, via: "play" | "app" = "play"): Promise<void> {
    this.phase = "waking";
    this.startedAt = this.now();
    this.endedAt = 0;
    this.by = { userId, name };
    try {
      await this.amp.call("Core", "Start");
    } catch (e) {
      this.end("failed");
      await this.audit({ userId, action: "server.wake", params: { name, via, failed: true }, result: "FAILED", detail: e instanceof Error ? e.message : String(e) });
      throw e;
    }
    await this.audit({ userId, action: "server.wake", params: { name, via }, result: "OK" });
  }

  /** Every status poll and every tick: Running ends the wake; three minutes without it is a failed wake. */
  async update(stateCode: number | null): Promise<void> {
    if (this.phase !== "waking") return;
    if (stateCode === 20) {
      this.end("ready");
      return;
    }
    if (this.now() - this.startedAt >= WAKE_TIMEOUT_MS) {
      this.end("failed");
      await this.audit({ userId: this.by?.userId ?? null, action: "server.wake", params: { name: this.by?.name ?? "", failed: true }, result: "FAILED", detail: "not running after 3 minutes" });
    }
  }

  view(): WakeView {
    const now = this.now();
    if ((this.phase === "ready" || this.phase === "failed") && now - this.endedAt > SHOW_END_MS) this.phase = "idle";
    const iso = (t: number) => (t ? new Date(t).toISOString() : null);
    return {
      phase: this.phase,
      startedAt: this.phase === "idle" ? null : iso(this.startedAt),
      endedAt: this.phase === "ready" || this.phase === "failed" ? iso(this.endedAt) : null,
      leftS: this.phase === "waking" ? Math.max(0, WAKE_EXPECT_S - Math.round((now - this.startedAt) / 1000)) : null,
      by: this.phase === "idle" ? null : (this.by?.name ?? null),
    };
  }

  private end(phase: "ready" | "failed") {
    this.phase = phase;
    this.endedAt = this.now();
  }
}
