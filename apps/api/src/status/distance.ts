import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import { runAction } from "../actions/run.js";
import type { ActionCtx } from "../actions/registry.js";
import { audit } from "../audit.js";
import { preview } from "../files/browse.js";
import type { RestartSchedule } from "./restart.js";

// Admin → Server → Settings: view and simulation distance (planner, 2026-10-01).
//
// Nothing the server runs can change them while it runs: vanilla has no command, none of the pack's mods calls
// PlayerList.setViewDistance (jars scanned 2026-10-01), and on Modrinth for NeoForge 1.21.1 there is only Dynamic
// Performance, an MSPT governor that moves them up and down by itself, not to a value it is given. So the value is
// written to AMP's own setting, and AMP writes it into server.properties when the server next starts.
// Node names read with Core.GetConfig on the live instance, 2026-10-01 (ViewDistance 10, SimulationDistance 8).

export const VIEW_NODE = "MinecraftModule.Minecraft.ViewDistance";
export const SIM_NODE = "MinecraftModule.Minecraft.SimulationDistance";
export const VIEW_PERMISSION = `Settings.${VIEW_NODE}`;
export const SIM_PERMISSION = `Settings.${SIM_NODE}`;
export const LIMITS = { view: { min: 4, max: 16 }, sim: { min: 4, max: 12 } } as const;

/** How long a TPS reading is good for, and how long the card waits for the server's answer. */
export const TICK_FRESH_MS = 10_000;
const TICK_WAIT_MS = 3_000;
/** Lines of one `neoforge tps` answer come within this of each other. */
const BATCH_MS = 400;

export type Pair = { view: number; sim: number };
export type Tick = { tps: number; mspt: number; at: string };
export type DistanceState = {
  /** What AMP holds: what the server gets at its next start. */
  amp: Partial<Pair> | null;
  /** What server.properties says, i.e. what the server started with (AMP writes the file at every start). */
  running: Partial<Pair> | null;
  allowed: { view: boolean | null; sim: boolean | null };
  permissions: { view: string; sim: string };
  limits: typeof LIMITS;
  tick: Tick | null;
  problem: string | null;
};

/** Pure: `view-distance` and `simulation-distance` out of server.properties. */
export function readProperties(text: string): Partial<Pair> {
  const out: Partial<Pair> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(view-distance|simulation-distance)\s*[=:]\s*(\d{1,3})\s*$/.exec(line);
    if (m) out[m[1] === "view-distance" ? "view" : "sim"] = Number(m[2]);
  }
  return out;
}

/** Pure: the audit lines for a change, one per value that moves. */
export function changes(before: Partial<Pair> | null, after: Pair): Array<{ what: "view" | "simulation"; from: number | null; to: number }> {
  const out: Array<{ what: "view" | "simulation"; from: number | null; to: number }> = [];
  if (before?.view !== after.view) out.push({ what: "view", from: before?.view ?? null, to: after.view });
  if (before?.sim !== after.sim) out.push({ what: "simulation", from: before?.sim ?? null, to: after.sim });
  return out;
}

export class Refusal extends Error {
  constructor(
    readonly code: "amp_permission" | "server_offline" | "amp_error" | "validation",
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class Distances {
  private tick: Tick | null = null;
  private asked = 0;
  private waiters: Array<() => void> = [];
  private batch: { at: number; tps: number; mspt: number; overall: boolean } | null = null;
  private settle: NodeJS.Timeout | null = null;

  constructor(
    private readonly amp: Amp,
    private readonly tail: ConsoleTail,
    private readonly ctx: () => ActionCtx,
    private readonly restarts: RestartSchedule,
    private readonly log: (o: unknown, m: string) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  start() {
    // NeoForge 1.21.1 on this server prints one line per dimension and no "Overall" line (seen 2026-10-01: Overworld,
    // The Nether, deepslate:limbo, The End). The lines of one answer arrive together: a tick takes as long as all
    // dimensions' ticks together, and runs as fast as the slowest. An "Overall" line, should one come, wins.
    this.tail.on((e, info) => {
      if (info.replay || e.type !== "tps") return;
      const at = this.now();
      if (e.scope === "overall") this.batch = { at, tps: e.tps, mspt: e.mspt, overall: true };
      else if (!this.batch || at - this.batch.at > BATCH_MS) this.batch = { at, tps: e.tps, mspt: e.mspt, overall: false };
      else if (!this.batch.overall) this.batch = { at, tps: Math.min(this.batch.tps, e.tps), mspt: this.batch.mspt + e.mspt, overall: false };
      this.tick = { tps: this.batch.tps, mspt: Math.round(this.batch.mspt * 1000) / 1000, at: new Date(at).toISOString() };
      if (this.settle) clearTimeout(this.settle);
      this.settle = setTimeout(() => {
        for (const w of this.waiters.splice(0)) w();
      }, BATCH_MS);
    });
  }

  /** The latest overall TPS/MSPT; asks the server (at most every 10 s, never while it is not up) when it is stale. */
  async measure(): Promise<Tick | null> {
    if (this.tail.state !== 20) return null;
    const fresh = this.tick && this.now() - Date.parse(this.tick.at) < TICK_FRESH_MS;
    if (fresh || this.now() - this.asked < TICK_FRESH_MS) return this.tick;
    this.asked = this.now();
    this.tail.hushTps(TICK_WAIT_MS + 5_000);
    const answered = new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      setTimeout(resolve, TICK_WAIT_MS);
    });
    const r = await runAction(this.amp, this.ctx(), "server.tps", {}, null);
    if (!r.ok) {
      this.log({ detail: r.detail }, "could not ask for the tick report");
      return this.tick;
    }
    await answered;
    return this.tick;
  }

  private async may(node: string): Promise<boolean | null> {
    return (this.amp.hasPermission ? this.amp.hasPermission(node) : this.amp.call<unknown>("Core", "CurrentSessionHasPermission", { PermissionNode: node }).then((v) => v === true)).catch(() => null);
  }

  private async ampValues(): Promise<Partial<Pair>> {
    const [v, s] = await Promise.all([VIEW_NODE, SIM_NODE].map((node) => this.amp.call<{ CurrentValue?: unknown }>("Core", "GetConfig", { node })));
    const n = (x: unknown) => (typeof x === "number" && Number.isInteger(x) ? x : typeof x === "string" && /^\d+$/.test(x) ? Number(x) : undefined);
    return { view: n(v?.CurrentValue), sim: n(s?.CurrentValue) };
  }

  async read(): Promise<DistanceState> {
    const [amp, running, view, sim, tick] = await Promise.all([
      this.ampValues().catch((e) => e as Error),
      preview(this.amp, "server.properties", [], 64 * 1024).then((p) => readProperties(p.text)).catch(() => null),
      this.may(VIEW_PERMISSION),
      this.may(SIM_PERMISSION),
      this.measure().catch(() => this.tick),
    ]);
    return {
      amp: amp instanceof Error ? null : amp,
      running,
      allowed: { view, sim },
      permissions: { view: VIEW_PERMISSION, sim: SIM_PERMISSION },
      limits: LIMITS,
      tick,
      problem: amp instanceof Error ? amp.message : null,
    };
  }

  /**
   * Writes the values to AMP and, with `apply: "now"`, plans a restart in one minute with the usual in-game warning.
   * With "next" they take effect whenever the server next starts (a restart, or waking up from sleep).
   */
  async set(want: Pair, apply: "now" | "next", by: string | null): Promise<{ state: DistanceState; changed: number; restart: { at: string } | null }> {
    if (want.view < LIMITS.view.min || want.view > LIMITS.view.max || want.sim < LIMITS.sim.min || want.sim > LIMITS.sim.max) {
      throw new Refusal("validation", `View distance is ${LIMITS.view.min} to ${LIMITS.view.max}, simulation distance ${LIMITS.sim.min} to ${LIMITS.sim.max}.`, 400);
    }
    if (apply === "now" && this.tail.state !== 20) throw new Refusal("server_offline", "The server isn't running, so there is nothing to restart. Choose \"at the next start\".", 409);
    const before = await this.ampValues().catch((e) => {
      throw new Refusal("amp_error", `AMP could not be asked for the current values: ${e instanceof Error ? e.message : String(e)}`, 502);
    });
    const todo = changes(before, want);
    for (const c of todo) {
      const permission = c.what === "view" ? VIEW_PERMISSION : SIM_PERMISSION;
      if ((await this.may(permission)) !== true) {
        await audit({ userId: by, action: "server.distance", params: { ...c, apply, refused: "amp_permission" }, result: "DENIED", detail: `AMP permission ${permission} missing` });
        throw new Refusal("amp_permission", `AMP does not let the portal change this. In the instance's own panel, give the role of the user "webapp" the permission ${permission}, then try again.`, 403);
      }
    }
    for (const c of todo) {
      const node = c.what === "view" ? VIEW_NODE : SIM_NODE;
      const r = await this.amp.call<{ Status?: boolean; Reason?: string } | null>("Core", "SetConfig", { node, value: String(c.to) }).catch((e) => ({ Status: false, Reason: String(e) }));
      const after = await this.ampValues().catch(() => null);
      const ok = (c.what === "view" ? after?.view : after?.sim) === c.to;
      await audit({ userId: by, action: "server.distance", params: { ...c, apply }, result: ok ? "OK" : "FAILED", detail: ok ? null : (r && typeof r === "object" && r.Reason) || "AMP did not change the setting" });
      if (!ok) throw new Refusal("amp_error", `AMP did not take the new ${c.what} distance${r && typeof r === "object" && r.Reason ? `: ${r.Reason}` : "."}`, 502);
    }
    const restart = apply === "now" ? this.restarts.schedule(1, by) : null;
    this.log({ want, apply, changed: todo.length }, "view/simulation distance");
    return { state: await this.read(), changed: todo.length, restart: restart ? { at: restart.at } : null };
  }
}
