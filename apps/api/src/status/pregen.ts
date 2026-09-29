import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import { runAction } from "../actions/run.js";
import type { ActionCtx } from "../actions/registry.js";
import { audit } from "../audit.js";

// Pre-generation (chunky), as a mode on Admin → Server (planner, 2026-09-29).
//
//   off    nothing generates, and nothing starts by itself
//   empty  chunky carries on whenever the server is empty and pauses as soon as anyone joins;
//          optionally only inside a window of the day, optionally for so many hours of generating at most
//   now    runs whoever is playing, for so many hours or until the area is done
//
// While a mode is due, AMP's sleep mode is switched off, and put back as it was when the mode ends. If AMP does
// not let the portal do that, the mode refuses to start.
//
// What this never does: start the server, or end its process. A server that is asleep or stopped stays so, and
// the pre-generation carries on at the next start somebody else makes. Before the api stops or restarts the
// server for any reason, a running pre-generation is paused and the save is waited for (`quiesce`).
//
// (For two hours on 2026-09-29 this worked in rounds around AMP's sleep, waking the server itself and ending a
// stop that hung. That is gone: a stop in the middle of generating is what hung the server that morning.)

export const SLEEP_NODE = "MinecraftModule.Limits.SleepMode";
export const SLEEP_DELAY_NODE = "MinecraftModule.Limits.SleepDelayMinutes";
export const SLEEP_PERMISSION = "Settings.MinecraftModule.Limits.SleepMode";
export const PLAN_KEY = "_pregen";

export type PregenState = {
  status: "none" | "running" | "paused" | "finished" | "cancelled";
  world: string | null;
  chunks: number | null;
  percent: number | null;
  eta: string | null;
  rate: number | null;
  at: string | null;
};

export type PregenEvent =
  | { type: "pregen"; what: "running"; world: string; chunks: number; percent: number; eta: string | null; rate: number | null }
  | { type: "pregen"; what: "started" | "continued" | "paused" | "stopped" | "cancelled"; world: string | null }
  | { type: "pregen"; what: "finished"; world: string; chunks: number | null };

const NONE: PregenState = { status: "none", world: null, chunks: null, percent: null, eta: null, rate: null, at: null };

/** Pure: the state after chunky has said something. */
export function nextPregen(s: PregenState, e: PregenEvent, at: Date): PregenState {
  const when = at.toISOString();
  switch (e.what) {
    case "running":
      return { status: "running", world: e.world, chunks: e.chunks, percent: e.percent, eta: e.eta, rate: e.rate, at: when };
    case "started":
      return { ...NONE, status: "running", world: e.world, chunks: 0, percent: 0, at: when };
    case "continued":
      return { ...s, status: "running", world: e.world ?? s.world, at: when };
    case "paused":
    case "stopped": // what chunky says when the server stops under it: the task is kept, as with a pause
      return s.status === "finished" || s.status === "cancelled" || s.status === "none" ? s : { ...s, status: "paused", eta: null, rate: null, at: when };
    case "cancelled":
      return { ...NONE, status: "cancelled", at: when };
    case "finished":
      return { status: "finished", world: e.world, chunks: e.chunks ?? s.chunks, percent: 100, eta: null, rate: null, at: when };
  }
}

/** What chunky last said. Old lines count too: after a restart of api the page should still say where it stands. */
export class PregenWatch {
  state: PregenState = NONE;
  /** When the game last said "Saved the game". */
  savedAt = 0;

  constructor(private readonly tail: ConsoleTail, private readonly now: () => number = () => Date.now()) {}

  start() {
    this.tail.on((e, info) => {
      if (e.type === "pregen") this.state = nextPregen(this.state, e, new Date(this.now()));
      if (e.type === "line" && !info.replay && /^Saved the game$/.test(e.text.trim())) this.savedAt = this.now();
    });
  }
}

// ---- the plan ------------------------------------------------------------------------------------------

export type Area = { x: number; z: number; radius: number };
export type Window = { from: string; to: string }; // "02:00", "08:00", UK time; may run over midnight

export type PregenPlan =
  | { mode: "off"; area: Area | null }
  | {
      mode: "empty" | "now";
      area: Area;
      window: Window | null; // "empty" only
      capHours: number | null; // hours of generating; null = until the area is done
      ranMs: number; // generating time so far
      since: string;
      by: string | null;
      /** True while the area has not been handed to chunky yet. */
      fresh: boolean;
      /** AMP's sleep mode as it was before this switched it off; null while it has not been touched. */
      sleepWas: boolean | null;
    };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutes = (hhmm: string) => {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Pure: "14:05" in UK time. */
export function ukClock(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(at).replace(/^24/, "00");
}

/** Pure: is the time of day inside the window? From 22:00 to 06:00 runs over midnight; from and to the same is all day. */
export function inWindow(w: Window | null, clock: string): boolean {
  if (!w) return true;
  const [from, to, now] = [minutes(w.from), minutes(w.to), minutes(clock)];
  if (from === null || to === null || now === null) return false;
  if (from === to) return true;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

export type Due = "yes" | "window" | "cap" | "done";

/** Pure: should it be generating, as far as the plan goes? */
export function due(plan: Exclude<PregenPlan, { mode: "off" }>, pregen: PregenState["status"], at: Date): Due {
  if (pregen === "finished") return "done";
  if (plan.capHours !== null && plan.ranMs >= plan.capHours * 3_600_000) return "cap";
  if (plan.mode === "empty" && !inWindow(plan.window, ukClock(at))) return "window";
  return "yes";
}

export type Step =
  | "off:done" // the area is finished: the mode ends
  | "off:cap" // the hours are up: the mode ends
  | "idle:window" // outside the window: paused, sleep as it was
  | "idle:server" // the server is not running: nothing is started
  | "pause:playing" // somebody is on and the mode is "when nobody's online"
  | "pause:sleep" // sleep could not be switched off and AMP is about to put the server to sleep
  | "run";

export type View = { serverRunning: boolean; online: number; pregen: PregenState["status"]; at: Date; sleepOff: boolean; emptyForMs: number | null; sleepDelayMin: number };

/** Pure: what to do now. Never "start the server", never "end it". */
export function step(plan: Exclude<PregenPlan, { mode: "off" }>, v: View): Step {
  const d = due(plan, v.pregen, v.at);
  if (d === "done") return "off:done";
  if (d === "cap") return "off:cap";
  if (d === "window") return "idle:window";
  if (!v.serverRunning) return "idle:server";
  if (plan.mode === "empty" && v.online > 0) return "pause:playing";
  // Sleep is still on (the permission was taken away, or the write did not take): pause in good time, accept the
  // sleep, carry on at the next start.
  if (!v.sleepOff && v.online === 0 && v.emptyForMs !== null && v.emptyForMs >= Math.max(1, v.sleepDelayMin - 2) * 60_000) return "pause:sleep";
  return "run";
}

export const sameArea = (a: Area | null, b: Area | null) => Boolean(a && b && a.x === b.x && a.z === b.z && a.radius === b.radius);

/** Pure: chunks in a square of that radius, as chunky counts them. */
export function chunksIn(radius: number): number {
  const side = Math.ceil((2 * radius) / 16) + 1;
  return side * side;
}

export type PlanStore = { load(): Promise<PregenPlan>; save(p: PregenPlan): Promise<void> };
export type SleepState = { node: string; permission: string; allowed: boolean | null; on: boolean | null; delayMin: number | null; checkedAt: string | null; problem: string | null };

export class Refused extends Error {
  constructor(readonly code: "sleep_permission" | "validation", message: string) {
    super(message);
  }
}

const AGAIN_MS = 45_000;
const OFF: PregenPlan = { mode: "off", area: null };

export class Pregen {
  plan: PregenPlan = OFF;
  lastStep: Step | "off" = "off";
  sleep: SleepState = { node: SLEEP_NODE, permission: SLEEP_PERMISSION, allowed: null, on: null, delayMin: null, checkedAt: null, problem: null };
  private emptySince: number | null = null;
  private lastCommand = 0;
  private lastTick = 0;
  private lastSave = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly amp: Amp,
    private readonly tail: ConsoleTail,
    readonly watch: PregenWatch,
    private readonly ctx: () => ActionCtx,
    private readonly store: PlanStore,
    private readonly log: (o: unknown, m: string) => void,
    private readonly now: () => number = () => Date.now(),
    private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async start() {
    const loaded = await this.store.load().catch(() => OFF);
    // anything that is not a plan as it is written today (an older shape, a broken row) is "off"
    this.plan = loaded && (loaded.mode === "empty" || loaded.mode === "now") && loaded.area ? loaded : { mode: "off", area: loaded?.area ?? null };
    this.lastTick = this.now();
    this.timer = setInterval(() => void this.tick().catch((err) => this.log({ err: String(err) }, "pregen tick failed")), 10_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** What AMP says about its sleep mode and about what the portal may do to it. Reads only. */
  async lookAtSleep(): Promise<SleepState> {
    const checkedAt = new Date(this.now()).toISOString();
    try {
      const [allowed, mode, delay] = await Promise.all([
        this.amp.call<unknown>("Core", "CurrentSessionHasPermission", { PermissionNode: SLEEP_PERMISSION }),
        this.amp.call<{ CurrentValue?: unknown }>("Core", "GetConfig", { node: SLEEP_NODE }),
        this.amp.call<{ CurrentValue?: unknown } | null>("Core", "GetConfig", { node: SLEEP_DELAY_NODE }).catch(() => null),
      ]);
      this.sleep = {
        node: SLEEP_NODE,
        permission: SLEEP_PERMISSION,
        allowed: allowed === true,
        on: typeof mode?.CurrentValue === "boolean" ? mode.CurrentValue : null,
        delayMin: typeof delay?.CurrentValue === "number" ? delay.CurrentValue : null,
        checkedAt,
        problem: null,
      };
    } catch (e) {
      this.sleep = { ...this.sleep, allowed: null, checkedAt, problem: e instanceof Error ? e.message : String(e) };
    }
    return this.sleep;
  }

  private async setSleep(on: boolean): Promise<boolean> {
    const r = await this.amp.call<{ Status?: boolean; Reason?: string } | null>("Core", "SetConfig", { node: SLEEP_NODE, value: on ? "true" : "false" }).catch((e) => ({ Status: false, Reason: String(e) }));
    const after = await this.lookAtSleep();
    const ok = after.on === on;
    if (!ok) this.sleep = { ...after, problem: (r && typeof r === "object" && r.Reason) || "AMP did not change the setting" };
    this.log({ on, ok, reason: ok ? undefined : this.sleep.problem }, "AMP sleep mode");
    return ok;
  }

  async turnOn(input: { mode: "empty" | "now"; area: Area; window: Window | null; capHours: number | null }, by: string | null) {
    const s = await this.lookAtSleep();
    if (s.allowed !== true) {
      await audit({ userId: by, action: "world.pregenOn", params: { mode: input.mode, refused: "sleep_permission" }, result: "DENIED", detail: s.problem });
      throw new Refused(
        "sleep_permission",
        s.allowed === null
          ? `Not turned on: AMP could not be asked whether the portal may switch sleep mode off (${s.problem ?? "no answer"}).`
          : `Not turned on: AMP does not let the portal switch sleep mode off, and without that the server is put to sleep in the middle of generating. In the instance's own panel, give the role of the user "webapp" the permission Settings → MinecraftModule → Limits → SleepMode (${SLEEP_PERMISSION}), then turn this on again.`,
      );
    }
    const was = this.plan;
    const status = this.watch.state.status;
    // Another area than the one chunky has: that one is called off first.
    const another = was.area !== null && !sameArea(was.area, input.area);
    if (was.mode !== "off") await this.turnOff("asked", by);
    if (another && this.tail.state === 20) await runAction(this.amp, this.ctx(), "world.pregenCancel", {}, by);
    const fresh = another || was.area === null || status === "finished" || status === "cancelled";
    if (fresh) this.watch.state = NONE;
    this.plan = { mode: input.mode, area: input.area, window: input.mode === "empty" ? input.window : null, capHours: input.capHours, ranMs: 0, since: new Date(this.now()).toISOString(), by, fresh, sleepWas: null };
    this.lastCommand = 0;
    await this.store.save(this.plan);
    await audit({ userId: by, action: "world.pregenOn", params: { mode: input.mode, ...input.area, window: input.window, capHours: input.capHours, newArea: fresh }, result: "OK" });
    await this.tick();
  }

  async turnOff(reason: "asked" | "cap" | "done", by: string | null = null) {
    const was = this.plan;
    if (was.mode === "off") return;
    const paused = await this.pause();
    if (was.sleepWas !== null) await this.setSleep(was.sleepWas);
    this.plan = { mode: "off", area: reason === "done" ? null : was.area };
    this.lastStep = "off";
    await this.store.save(this.plan);
    await audit({ userId: by, action: "world.pregenOff", params: { reason, percent: this.watch.state.percent, chunks: this.watch.state.chunks, sleepRestored: was.sleepWas }, result: paused ? "OK" : "FAILED" });
  }

  /** Stop, and make chunky forget where it got to. */
  async cancel(by: string | null) {
    await this.turnOff("asked", by);
    if (this.tail.state === 20) await runAction(this.amp, this.ctx(), "world.pregenCancel", {}, by);
    this.plan = OFF;
    await this.store.save(this.plan);
  }

  private async pause(): Promise<boolean> {
    if (this.tail.state !== 20 || this.watch.state.status !== "running") return true;
    return (await runAction(this.amp, this.ctx(), "world.pregenPause", {}, null)).ok;
  }

  /**
   * Before the api stops or restarts the server, for whatever reason: a running pre-generation is paused and the
   * save is waited for (a minute at most). A stop in the middle of generating hung the server at "Saving worlds".
   */
  async quiesce(): Promise<{ paused: boolean; saved: boolean }> {
    if (this.tail.state !== 20 || this.watch.state.status !== "running") return { paused: false, saved: true };
    const asked = this.now();
    const ok = (await runAction(this.amp, this.ctx(), "world.pregenPause", {}, null)).ok;
    for (let i = 0; ok && i < 60; i++) {
      if (this.watch.savedAt >= asked) return { paused: true, saved: true };
      await this.wait(1000);
    }
    this.log({ ok }, "pre-generation paused before a stop; the save was not seen to finish");
    return { paused: ok, saved: false };
  }

  async tick() {
    const now = this.now();
    const dt = Math.max(0, Math.min(60_000, now - this.lastTick));
    this.lastTick = now;
    const running = this.tail.state === 20;
    const online = this.tail.online.size;
    if (!running || online > 0) this.emptySince = null;
    else this.emptySince ??= now;

    if (this.plan.mode === "off") {
      // Nobody has turned anything on: a pre-generation started by hand on the console is not left to meet AMP's sleep.
      if (running && online === 0 && this.watch.state.status === "running" && this.emptySince !== null && now - this.emptySince >= 3 * 60_000) {
        this.emptySince = null;
        await this.pause();
        await audit({ action: "world.pregenAutoPause", params: { percent: this.watch.state.percent, chunks: this.watch.state.chunks }, result: "OK" });
      }
      return;
    }
    if (this.watch.state.status === "running") this.plan = { ...this.plan, ranMs: this.plan.ranMs + dt };
    const isDue = due(this.plan, this.watch.state.status, new Date(now)) === "yes";

    // AMP's sleep: off while the mode is due, as it was otherwise.
    if (isDue && this.plan.sleepWas === null) {
      const s = await this.lookAtSleep();
      if (s.on === false) this.plan = { ...this.plan, sleepWas: false };
      else if (s.on === true && s.allowed === true && (await this.setSleep(false))) this.plan = { ...this.plan, sleepWas: true };
      if (this.plan.sleepWas !== null) await this.store.save(this.plan);
    } else if (!isDue && this.plan.sleepWas !== null) {
      await this.setSleep(this.plan.sleepWas);
      this.plan = { ...this.plan, sleepWas: null };
      await this.store.save(this.plan);
    }
    if (now - this.lastSave >= 60_000) {
      this.lastSave = now;
      await this.store.save(this.plan);
    }

    const s = step(this.plan, { serverRunning: running, online, pregen: this.watch.state.status, at: new Date(now), sleepOff: this.plan.sleepWas !== null && this.sleep.on === false, emptyForMs: this.emptySince === null ? null : now - this.emptySince, sleepDelayMin: this.sleep.delayMin ?? 5 });
    if (s !== this.lastStep) this.log({ step: s, online, percent: this.watch.state.percent }, "pregen");
    this.lastStep = s;
    switch (s) {
      case "off:done":
        return this.turnOff("done");
      case "off:cap":
        return this.turnOff("cap");
      case "idle:server":
        return;
      case "idle:window":
      case "pause:playing":
      case "pause:sleep":
        if (this.watch.state.status === "running" && now - this.lastCommand >= 15_000) {
          this.lastCommand = now;
          await this.pause();
        }
        return;
      case "run": {
        if (this.watch.state.status === "running" || now - this.lastCommand < AGAIN_MS) return;
        this.lastCommand = now;
        if (this.plan.fresh) {
          const r = await runAction(this.amp, this.ctx(), "world.pregen", this.plan.area, this.plan.by);
          if (r.ok) {
            this.plan = { ...this.plan, fresh: false };
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
