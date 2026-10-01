import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import { runAction } from "../actions/run.js";
import { COUNTED, GROUND_DONE, GROUND_MARK, OLD_ITEM_TICKS, type ActionCtx, type ActionName, type Counted } from "../actions/registry.js";
import { countReply, functionReply, killReply, reduce } from "../events/parse.js";

// Admin → Server → Settings: what is lying around, and clearing items on the ground (planner, 2026-10-01). No mod:
// the datapack deepslate-tools writes each item's Age into a score (ground/mark), the console kills the item
// entities older than 2 minutes and answers "Killed N entities", which goes into the event log.
// The counts are `execute if entity <selector>` asked one at a time, because the answer ("Test passed, count: N")
// does not say what it counted.

export const PLAN_KEY = "_groundItems";
export type GroundPlan = { auto: boolean; threshold: number };
export const DEFAULT_PLAN: GroundPlan = { auto: false, threshold: 1500 };
export const THRESHOLD = { min: 200, max: 20_000 } as const;
export const CHECK_EVERY_MS = 10 * 60_000;
const COUNTS_FRESH_MS = 60_000;
const ANSWER_MS = 3_000;

export type Counts = { at: string; values: Partial<Record<Counted, number>>; problems: Partial<Record<Counted, string>> };
export type Clearing = { by: "button" | "schedule"; step: "warned60" | "warned10" | "clearing"; clearsAt: string };
export type LastClear = { at: string; removed: number | null; by: "button" | "schedule"; before: number | null; problem: string | null };
export type GroundState = { plan: GroundPlan; counts: Counts | null; clearing: Clearing | null; last: LastClear | null; running: boolean; oldAfterSeconds: number; checkEveryMin: number };

export type AuditFn = (a: { userId: string | null; action: string; params: object; result: string; detail?: string | null }) => Promise<void>;
export type PlanStore = { load(): Promise<unknown>; save(p: GroundPlan): Promise<void> };

/** Pure: a stored plan, read leniently (a missing or odd value is the default: off, 1,500). */
export function readPlan(raw: unknown): GroundPlan {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const t = typeof o.threshold === "number" && Number.isInteger(o.threshold) ? Math.min(THRESHOLD.max, Math.max(THRESHOLD.min, o.threshold)) : DEFAULT_PLAN.threshold;
  return { auto: o.auto === true, threshold: t };
}

/** Pure: whether the schedule clears now. Only above the threshold, never while a clear is under way or the server is down. */
export function dueToClear(plan: GroundPlan, items: number | null, busy: boolean, running: boolean): boolean {
  return plan.auto && running && !busy && items !== null && items > plan.threshold;
}

export class GroundItems {
  private counts: Counts | null = null;
  private clearing: Clearing | null = null;
  private last: LastClear | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly amp: Amp,
    private readonly tail: ConsoleTail,
    private readonly ctx: () => ActionCtx,
    private readonly store: PlanStore,
    private readonly audit: AuditFn,
    private readonly log: (o: unknown, m: string) => void,
    private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = () => Date.now(),
  ) {}

  start() {
    this.timer = setInterval(() => void this.check().catch((err) => this.log({ err: String(err) }, "ground items check failed")), CHECK_EVERY_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private get running() {
    return this.tail.state === 20;
  }

  async plan(): Promise<GroundPlan> {
    return readPlan(await this.store.load().catch(() => null));
  }

  async setPlan(want: GroundPlan, by: string | null): Promise<GroundPlan> {
    const plan = readPlan(want);
    const before = await this.plan();
    await this.store.save(plan);
    if (before.auto !== plan.auto || before.threshold !== plan.threshold) await this.audit({ userId: by, action: "items.clearPlan", params: plan, result: "OK" });
    return plan;
  }

  /**
   * Sends one action and waits for the first console line `match` recognises (or `ANSWER_MS`). One at a time: two
   * questions in flight would get each other's "Test passed, count: N".
   */
  private ask<T>(name: ActionName, input: unknown, match: (message: string) => T | null): Promise<T | null> {
    const next = this.queue.then(async () => {
      let found: T | null = null;
      let done: () => void = () => {};
      const answered = new Promise<void>((r) => (done = r));
      const handler = (e: { type: string; text?: string }, info: { replay: boolean }) => {
        if (info.replay || e.type !== "line" || found !== null) return;
        const hit = match(reduce(e.text ?? "").message);
        if (hit !== null) {
          found = hit;
          done();
        }
      };
      this.tail.on(handler);
      try {
        this.tail.hushCount(ANSWER_MS + 5_000);
        const r = await runAction(this.amp, this.ctx(), name, input, null);
        if (!r.ok) return null;
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([answered, new Promise<void>((r) => (timer = setTimeout(r, ANSWER_MS)))]);
        clearTimeout(timer);
        return found;
      } finally {
        this.tail.off(handler);
      }
    });
    this.queue = next.catch(() => null);
    return next;
  }

  private async countOne(what: Counted): Promise<{ count?: number; problem?: string }> {
    const r = await this.ask("ground.count", { what }, countReply);
    if (r === null) return { problem: "no answer" };
    return r.ok ? { count: r.count } : { problem: r.message };
  }

  /** Everything the card shows, at most once a minute; null while the server is not up. */
  async measure(force = false): Promise<Counts | null> {
    if (!this.running) return this.counts;
    if (!force && this.counts && this.now() - Date.parse(this.counts.at) < COUNTS_FRESH_MS) return this.counts;
    const values: Counts["values"] = {};
    const problems: Counts["problems"] = {};
    for (const what of COUNTED) {
      const r = await this.countOne(what);
      if (r.count !== undefined) values[what] = r.count;
      else problems[what] = r.problem ?? "no answer";
    }
    this.counts = { at: new Date(this.now()).toISOString(), values, problems };
    return this.counts;
  }

  async read(): Promise<GroundState> {
    const [plan, counts] = await Promise.all([this.plan(), this.measure().catch(() => this.counts)]);
    return { plan, counts, clearing: this.clearing, last: this.last, running: this.running, oldAfterSeconds: OLD_ITEM_TICKS / 20, checkEveryMin: CHECK_EVERY_MS / 60_000 };
  }

  /** Every 10 minutes: with the schedule on and more items lying around than the threshold, a clear with the usual warnings. */
  async check(): Promise<boolean> {
    const plan = await this.plan();
    if (!plan.auto || !this.running || this.clearing) return false;
    const items = await this.countOne("items");
    if (!dueToClear(plan, items.count ?? null, this.clearing !== null, this.running)) return false;
    void this.clear("schedule", null, plan.threshold, items.count ?? null).catch((err) => this.log({ err: String(err) }, "scheduled ground clear failed"));
    return true;
  }

  /**
   * Starts a clear and returns at once: a warning now, another at 10 s to go, then item entities older than 2 minutes
   * go. Refused while the server is down or a clear is already counting down.
   */
  begin(by: string | null): { ok: true; clearsAt: string } | { ok: false; code: "server_offline" | "busy" } {
    if (!this.running) return { ok: false, code: "server_offline" };
    if (this.clearing) return { ok: false, code: "busy" };
    void this.clear("button", by, null, null).catch((err) => this.log({ err: String(err) }, "ground clear failed"));
    return { ok: true, clearsAt: this.clearing!.clearsAt };
  }

  private async clear(how: "button" | "schedule", by: string | null, threshold: number | null, seen: number | null): Promise<LastClear> {
    const clearsAt = new Date(this.now() + 60_000).toISOString();
    this.clearing = { by: how, step: "warned60", clearsAt };
    let removed: number | null = null;
    let before: number | null = seen;
    let problem: string | null = null;
    try {
      await runAction(this.amp, this.ctx(), "ground.warn", { seconds: 60 }, null);
      await this.wait(50_000);
      if (!this.running) throw new Error("the server stopped during the countdown");
      this.clearing = { ...this.clearing, step: "warned10" };
      await runAction(this.amp, this.ctx(), "ground.warn", { seconds: 10 }, null);
      await this.wait(10_000);
      if (!this.running) throw new Error("the server stopped during the countdown");
      this.clearing = { ...this.clearing, step: "clearing" };
      before = (await this.countOne("items")).count ?? before;
      const marked = await this.ask("ground.mark", {}, (m) => functionReply(m, GROUND_MARK));
      if (marked === false) throw new Error("the datapack deepslate-tools is not loaded: restart the server once after Sync");
      removed = await this.ask("ground.kill", {}, killReply);
      if (removed === null) throw new Error("the server did not say how many items went");
      await this.ask("ground.done", { removed }, (m) => functionReply(m, GROUND_DONE));
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      this.clearing = null;
    }
    this.last = { at: new Date(this.now()).toISOString(), removed, by: how, before, problem };
    this.counts = null; // the card asks again
    await this.audit({
      userId: by,
      action: "items.clear",
      params: { removed, before, auto: how === "schedule", threshold },
      result: problem ? "FAILED" : "OK",
      detail: problem,
    });
    this.log({ removed, before, how, problem }, "cleared items on the ground");
    return this.last;
  }
}
