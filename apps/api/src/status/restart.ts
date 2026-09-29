import type { Amp } from "../amp/client.js";
import { runAction } from "../actions/run.js";
import type { ActionCtx } from "../actions/registry.js";
import { audit } from "../audit.js";

// docs/05 "scheduled restart in N minutes with an in-game warning countdown (say every minute for the last 5)".
// One restart can be pending at a time. The plan lives in memory: if api itself restarts, the plan is gone
// and nothing restarts, which is the safe way round.

export type Plan = { at: string; minutes: number; by: string | null; warned: number[] };

/** Minutes-before-restart at which to warn: now (if more than 5 min away), then 5, 4, 3, 2, 1. */
export function warningMinutes(minutes: number): number[] {
  const out = minutes > 5 ? [minutes] : [];
  for (let m = Math.min(5, minutes); m >= 1; m--) out.push(m);
  return out;
}

export class RestartSchedule {
  private plan: Plan | null = null;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly amp: Amp,
    private readonly ctx: () => ActionCtx,
    private readonly log: (o: unknown, m: string) => void,
    /** Called before the server is restarted: a running pre-generation is paused and saved first. */
    private readonly before: () => Promise<unknown> = async () => undefined,
  ) {}

  get current(): Plan | null {
    return this.plan;
  }

  schedule(minutes: number, by: string | null): Plan {
    this.clear();
    const due = Date.now() + minutes * 60_000;
    const plan: Plan = { at: new Date(due).toISOString(), minutes, by, warned: [] };
    this.plan = plan;
    for (const m of warningMinutes(minutes)) {
      this.timers.push(setTimeout(() => void this.warn(plan, m), Math.max(0, due - m * 60_000 - Date.now())));
    }
    this.timers.push(setTimeout(() => void this.fire(plan), Math.max(0, due - Date.now())));
    void audit({ userId: by, action: "server.restart.scheduled", params: { minutes, at: plan.at }, result: "OK" });
    return plan;
  }

  async cancel(by: string | null): Promise<boolean> {
    if (!this.plan) return false;
    this.clear();
    await runAction(this.amp, this.ctx(), "server.restartCancelled", {}, null).catch((e) => this.log({ err: String(e) }, "cancel notice failed"));
    await audit({ userId: by, action: "server.restart.cancelled", params: {}, result: "OK" });
    return true;
  }

  stop() {
    this.clear();
  }

  private clear() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.plan = null;
  }

  private async warn(plan: Plan, minutes: number) {
    if (this.plan !== plan) return;
    plan.warned.push(minutes);
    await runAction(this.amp, this.ctx(), "server.restartWarning", { minutes }, null).catch((e) => this.log({ err: String(e) }, "restart warning failed"));
  }

  private async fire(plan: Plan) {
    if (this.plan !== plan) return;
    this.timers = [];
    this.plan = null;
    try {
      await runAction(this.amp, this.ctx(), "server.restartWarning", { minutes: 0 }, null).catch(() => undefined);
      await this.before().catch((e) => this.log({ err: String(e) }, "could not pause the pre-generation before the restart"));
      await this.amp.call("Core", "Restart");
      await audit({ userId: plan.by, action: "server.restart", params: { scheduled: true, minutes: plan.minutes }, result: "OK" });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      this.log({ err: detail }, "scheduled restart failed");
      await audit({ userId: plan.by, action: "server.restart", params: { scheduled: true, minutes: plan.minutes }, result: "FAILED", detail });
    }
  }
}
