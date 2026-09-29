import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import { runAction } from "../actions/run.js";
import type { ActionCtx } from "../actions/registry.js";
import { audit } from "../audit.js";

// Pre-generation (chunky). It runs only when an admin has turned it on from Admin → Server; nothing here starts
// or continues it. What this keeps is what chunky last said, for that page, and one safeguard: a server that has
// been empty for three minutes is about to be put to sleep by AMP, and a stop in the middle of generating hung the
// server at "Saving worlds" (2026-09-29). So an empty server's pre-generation is paused, and saved, before that.

export const EMPTY_PAUSE_MS = 3 * 60_000;

export type PregenState = {
  status: "none" | "running" | "paused" | "finished" | "cancelled";
  world: string | null;
  chunks: number | null;
  percent: number | null;
  eta: string | null;
  rate: number | null;
  /** Why it is paused, when api did it by itself. */
  pausedBy: "empty" | null;
  at: string | null;
};

export type PregenEvent =
  | { type: "pregen"; what: "running"; world: string; chunks: number; percent: number; eta: string | null; rate: number | null }
  | { type: "pregen"; what: "started" | "continued" | "paused" | "stopped" | "cancelled"; world: string | null }
  | { type: "pregen"; what: "finished"; world: string; chunks: number | null };

const NONE: PregenState = { status: "none", world: null, chunks: null, percent: null, eta: null, rate: null, pausedBy: null, at: null };

/** Pure: the state after chunky has said something. */
export function nextPregen(s: PregenState, e: PregenEvent, at: Date): PregenState {
  const when = at.toISOString();
  switch (e.what) {
    case "running":
      return { status: "running", world: e.world, chunks: e.chunks, percent: e.percent, eta: e.eta, rate: e.rate, pausedBy: null, at: when };
    case "started":
      return { ...NONE, status: "running", world: e.world, chunks: 0, percent: 0, at: when };
    case "continued":
      return { ...s, status: "running", world: e.world ?? s.world, pausedBy: null, at: when };
    case "paused":
    case "stopped": // what chunky says when the server stops under it: the task is kept, as with a pause
      return s.status === "finished" || s.status === "cancelled" || s.status === "none" ? s : { ...s, status: "paused", eta: null, rate: null, at: when };
    case "cancelled":
      return { ...NONE, status: "cancelled", at: when };
    case "finished":
      return { status: "finished", world: e.world, chunks: e.chunks ?? s.chunks, percent: 100, eta: null, rate: null, pausedBy: null, at: when };
  }
}

/** Pure: is it time to pause because the server is empty? */
export function shouldPauseEmpty(s: PregenState, running: boolean, online: number, emptySince: number | null, now: number): boolean {
  return s.status === "running" && running && online === 0 && emptySince !== null && now - emptySince >= EMPTY_PAUSE_MS;
}

export class PregenWatch {
  state: PregenState = NONE;
  private emptySince: number | null = null;

  constructor(
    private readonly amp: Amp,
    private readonly tail: ConsoleTail,
    private readonly ctx: () => ActionCtx,
    private readonly log: (o: unknown, m: string) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  start() {
    // Old lines count too: after a restart of api the page should still say where the pre-generation stands.
    this.tail.on((e) => {
      if (e.type === "pregen") this.state = nextPregen(this.state, e, new Date(this.now()));
    });
  }

  async look() {
    const running = this.tail.state === 20;
    const online = this.tail.online.size;
    if (!running || online > 0 || this.state.status !== "running") this.emptySince = null;
    else this.emptySince ??= this.now();
    if (!shouldPauseEmpty(this.state, running, online, this.emptySince, this.now())) return;
    this.emptySince = null;
    const r = await runAction(this.amp, this.ctx(), "world.pregenPause", {}, null);
    this.log({ ok: r.ok, at: this.state.percent }, "pre-generation paused: the server has been empty for three minutes");
    if (r.ok) this.state = { ...this.state, status: "paused", pausedBy: "empty", eta: null, rate: null, at: new Date(this.now()).toISOString() };
    await audit({ action: "world.pregenAutoPause", params: { percent: this.state.percent, chunks: this.state.chunks }, result: r.ok ? "OK" : "FAILED", detail: r.detail ?? null });
  }
}

// ---- running it for hours (Alex, 2026-09-29: "run for 8 hours or always run when no one online") ----------
// AMP puts an empty server to sleep about six minutes after it became empty, whatever it is doing. So the
// keeper works in rounds: generate for a few minutes, pause and save in good time before the sleep, let AMP put
// the server to sleep with nothing going on, wake it, carry on. While somebody is playing it waits (unless told
// otherwise), so that nobody builds on a server that is busy generating.

export type PregenTask = { x: number; z: number; radius: number };
export type PregenPlan =
  | { mode: "off" }
  | {
      mode: "hours" | "empty"; // "hours": until `until`; "empty": until the task is finished
      until: string | null;
      whilePlaying: boolean;
      /** A task to start; null = carry on with the one chunky has. */
      task: PregenTask | null;
      started: boolean;
      since: string;
      by: string | null;
    };

export const PLAN_KEY = "_pregen";
export const RUN_FIRST_MS = 210_000; // until AMP's own timing has been seen once
const RUN_MIN_MS = 120_000;
const RUN_MAX_MS = 600_000;
const MARGIN_MS = 100_000; // paused this long before AMP would stop the server
const HANG_MS = 4 * 60_000;
const AGAIN_MS = 45_000;

/** Pure: how long a round may generate, from the shortest time AMP has been seen to wait before a sleep. */
export function roundLength(idleSeenMs: number | null): number {
  if (idleSeenMs === null) return RUN_FIRST_MS;
  return Math.min(RUN_MAX_MS, Math.max(RUN_MIN_MS, idleSeenMs - MARGIN_MS));
}

export type KeeperView = { state: number; online: number; emptyForMs: number | null; stoppingForMs: number | null; pregen: PregenState["status"]; now: number };
export type KeeperStep = "off:time" | "off:done" | "kill" | "wait" | "wake" | "run" | "pause:playing" | "pause:round";

/** Pure: what to do now. */
export function keeperStep(plan: Exclude<PregenPlan, { mode: "off" }>, v: KeeperView, runForMs: number): KeeperStep {
  if (v.pregen === "finished") return "off:done";
  if (plan.until && v.now >= Date.parse(plan.until)) return "off:time";
  if (v.state === 45) return v.stoppingForMs !== null && v.stoppingForMs >= HANG_MS ? "kill" : "wait";
  if (v.state === 30 || v.state === 50) return "wake";
  if (v.state !== 20) return "wait"; // starting, or stopped by somebody: not ours to start
  if (v.online > 0) return plan.whilePlaying ? "run" : "pause:playing";
  return v.emptyForMs !== null && v.emptyForMs >= runForMs ? "pause:round" : "run";
}

export type KeeperStore = { load(): Promise<PregenPlan>; save(p: PregenPlan): Promise<void> };

export class PregenKeeper {
  plan: PregenPlan = { mode: "off" };
  /** The shortest time AMP has been seen to leave an empty server running. */
  idleSeenMs: number | null = null;
  lastStep: KeeperStep | "off" = "off";
  private emptySince: number | null = null;
  private stoppingSince: number | null = null;
  private lastCommand = 0;
  private wokeAt = 0;
  private wasRunning = false;
  private startAfterKill = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly amp: Amp,
    private readonly tail: ConsoleTail,
    private readonly watch: PregenWatch,
    private readonly ctx: () => ActionCtx,
    private readonly store: KeeperStore,
    private readonly log: (o: unknown, m: string) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async start() {
    this.plan = await this.store.load().catch(() => ({ mode: "off" }) as PregenPlan);
    this.tail.on((e, info) => {
      if (info.replay) return;
      if (e.type === "started" || e.type === "leave" || e.type === "join") this.emptySince = null; // counted afresh at the next look
    });
    this.timer = setInterval(() => void this.tick().catch((err) => this.log({ err: String(err) }, "pregen keeper failed")), 10_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  get runForMs() {
    return roundLength(this.idleSeenMs);
  }

  async turnOn(input: { mode: "hours" | "empty"; hours?: number; whilePlaying: boolean; task: PregenTask | null }, by: string | null) {
    const since = new Date(this.now());
    this.plan = {
      mode: input.mode,
      until: input.mode === "hours" ? new Date(since.getTime() + (input.hours ?? 8) * 3_600_000).toISOString() : null,
      whilePlaying: input.whilePlaying,
      task: input.task,
      started: input.task === null,
      since: since.toISOString(),
      by,
    };
    this.lastCommand = 0;
    await this.store.save(this.plan);
    await audit({ userId: by, action: "world.pregenOn", params: { mode: input.mode, hours: input.mode === "hours" ? (input.hours ?? 8) : null, whilePlaying: input.whilePlaying, ...(input.task ?? {}) }, result: "OK" });
    await this.tick();
  }

  async turnOff(reason: "asked" | "time" | "done", by: string | null = null) {
    const was = this.plan;
    this.plan = { mode: "off" };
    this.lastStep = "off";
    await this.store.save(this.plan);
    let paused = true;
    if (this.tail.state === 20 && this.watch.state.status === "running") paused = (await runAction(this.amp, this.ctx(), "world.pregenPause", {}, null)).ok;
    if (was.mode !== "off") await audit({ userId: by, action: "world.pregenOff", params: { reason, percent: this.watch.state.percent, chunks: this.watch.state.chunks }, result: paused ? "OK" : "FAILED" });
  }

  async tick() {
    const now = this.now();
    const state = this.tail.state;
    const online = this.tail.online.size;
    const running = state === 20;
    // AMP's timing, learnt by watching: an empty, running server that stops without having been told to
    if (this.wasRunning && !running && this.emptySince !== null && (state === 45 || state === 50 || state === 30)) {
      const idle = now - this.emptySince;
      if (idle > 60_000 && idle < 3_600_000) this.idleSeenMs = this.idleSeenMs === null ? idle : Math.min(this.idleSeenMs, idle);
    }
    this.wasRunning = running;
    if (!running || online > 0) this.emptySince = null;
    else this.emptySince ??= now;
    if (state === 45) this.stoppingSince ??= now;
    else this.stoppingSince = null;

    if (this.plan.mode === "off") {
      await this.watch.look(); // the safeguard for a pre-generation somebody started by hand
      return;
    }
    const step = this.startAfterKill && state === 0 ? "wake" : keeperStep(this.plan, { state, online, emptyForMs: this.emptySince === null ? null : now - this.emptySince, stoppingForMs: this.stoppingSince === null ? null : now - this.stoppingSince, pregen: this.watch.state.status, now }, this.runForMs);
    if (step !== this.lastStep) this.log({ step, state, online, percent: this.watch.state.percent, runForSec: Math.round(this.runForMs / 1000) }, "pregen keeper");
    this.lastStep = step;
    switch (step) {
      case "off:time":
        return this.turnOff("time");
      case "off:done":
        return this.turnOff("done");
      case "wait":
        return;
      case "kill": {
        this.stoppingSince = null;
        const ok = await this.amp.call("Core", "Kill").then(() => true, () => false);
        this.startAfterKill = ok;
        await audit({ action: "server.kill", params: { by: "pregen", after: "4 minutes in Stopping" }, result: ok ? "OK" : "FAILED" });
        return;
      }
      case "wake": {
        if (now - this.wokeAt < 60_000) return;
        this.wokeAt = now;
        this.startAfterKill = false;
        const ok = await this.amp.call("Core", "Start").then(() => true, () => false);
        if (!ok) this.log({ state }, "pregen keeper: could not wake the server");
        return;
      }
      case "pause:playing":
      case "pause:round": {
        if (this.watch.state.status !== "running" || now - this.lastCommand < 15_000) return;
        this.lastCommand = now;
        await runAction(this.amp, this.ctx(), "world.pregenPause", {}, null);
        return;
      }
      case "run": {
        if (this.watch.state.status === "running" || now - this.lastCommand < AGAIN_MS) return;
        this.lastCommand = now;
        if (!this.plan.started && this.plan.task) {
          const r = await runAction(this.amp, this.ctx(), "world.pregen", this.plan.task, this.plan.by);
          if (r.ok) {
            this.plan = { ...this.plan, started: true };
            await this.store.save(this.plan);
          }
          return;
        }
        await runAction(this.amp, this.ctx(), "world.pregenContinue", {}, null);
        return;
      }
    }
  }
}
