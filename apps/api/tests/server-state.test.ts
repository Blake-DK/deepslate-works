import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { serviceAuth } from "../src/auth.js";
import { MockAmp, type AmpStatus } from "../src/amp/client.js";
import { serverState, stateHint, stateLine, wakeDecision, WAKE_TEXT, JOINABLE, AVAILABLE, type ServerState } from "../src/shared/server-state.js";
import { Wake } from "../src/status/wake.js";
import { ServerView, reasonFor, sleepIn } from "../src/status/view.js";
import { wakeRoutes, type WakeDeps } from "../src/routes/wake.js";
import { statusRoutes } from "../src/routes/status.js";
import type { LiveStatus } from "../src/status/poller.js";

// docs/13 §12 (planner, 2026-09-30): one set of words for the server's state, and wake on Play.

const up = { reachable: true, waking: false, crashed: false };

describe("serverState: the table", () => {
  it("maps AMP's states", () => {
    const cases: Array<[number | null, ServerState]> = [[20, "online"], [45, "asleep"], [50, "asleep"], [5, "starting"], [7, "starting"], [10, "starting"], [60, "starting"], [30, "restarting"], [40, "stopping"], [0, "off"], [100, "crashed"], [200, "off"], [250, "off"], [null, "unreachable"], [-1, "unreachable"], [999, "unreachable"]];
    for (const [code, want] of cases) expect([code, serverState({ ...up, stateCode: code })]).toEqual([code, want]);
  });
  it("says Crashed for a stop without a stop line, Switched off for a clean one", () => {
    expect(serverState({ ...up, stateCode: 0, crashed: true })).toBe("crashed");
    expect(serverState({ ...up, stateCode: 0, crashed: false })).toBe("off");
  });
  it("never calls an AMP it cannot reach offline or switched off", () => {
    for (const code of [0, 20, 30, 100]) expect(serverState({ ...up, stateCode: code, reachable: false })).toBe("unreachable");
  });
  it("is Waking while a wake runs, until it is Running", () => {
    for (const code of [45, 50, 5, 10]) expect(serverState({ ...up, stateCode: code, waking: true })).toBe("waking");
    expect(serverState({ ...up, stateCode: 20, waking: true })).toBe("online");
  });
  it("counts Asleep and Waking as available and joinable", () => {
    for (const s of ["online", "asleep", "waking"] as const) expect([AVAILABLE.has(s), JOINABLE.has(s)]).toEqual([true, true]);
    for (const s of ["off", "crashed", "unreachable", "starting", "stopping", "restarting"] as const) expect([s, AVAILABLE.has(s)]).toEqual([s, false]);
  });
});

describe("the words", () => {
  it("are the planner's", () => {
    expect(stateLine("online", { players: 3 })).toBe("Online, 3 playing");
    expect(stateLine("online", { players: 0 })).toBe("Online, nobody on");
    expect(stateLine("online", { players: 0, sleepInMin: 3.6 })).toBe("Online, nobody on, goes to sleep in about 4 min");
    expect(stateLine("asleep")).toBe("Asleep, join to wake it");
    expect(stateLine("waking", { wakeLeftS: 20 })).toBe("Waking up… about 20 s");
    expect(stateLine("waking", { wakeLeftS: 0 })).toBe("Waking up…");
    expect([stateLine("starting"), stateLine("stopping"), stateLine("restarting")]).toEqual(["Starting…", "Stopping…", "Restarting…"]);
    expect([stateLine("off"), stateLine("crashed"), stateLine("unreachable")]).toEqual(["Switched off", "Crashed", "Can't reach the server"]);
    expect(stateHint("off", false)).toBe("The server is switched off. Ask Alex in Discord.");
    expect(stateHint("off", true)).toContain("Start it here");
    expect(WAKE_TEXT).toEqual({ waking: "Waking the server, ready in about 30 s", ready: "Server ready", failed: "The server didn't wake up. Try again in a minute or tell Alex" });
  });
  it("say when an empty server goes to sleep", () => {
    expect(sleepIn({ running: true, players: 0, emptySince: 0, sleepOn: true, delayMin: 5, now: 60_000 })).toBe(4);
    expect(sleepIn({ running: true, players: 0, emptySince: 0, sleepOn: true, delayMin: 5, now: 10 * 60_000 })).toBe(1);
    expect(sleepIn({ running: true, players: 1, emptySince: 0, sleepOn: true, delayMin: 5, now: 0 })).toBeNull();
    expect(sleepIn({ running: true, players: 0, emptySince: 0, sleepOn: false, delayMin: 5, now: 0 })).toBeNull(); // pre-generation keeps it awake
  });
  it("give admins the reason AMP can't be reached", () => {
    expect(reasonFor("AMP login failed: unknown", true)).toBe("login refused");
    expect(reasonFor("fetch failed", false)).toBe("tunnel down");
    expect(reasonFor("HTTP 503 Service Unavailable", true)).toBe("instance not running");
    expect(reasonFor("timeout", true)).toBe("AMP not answering");
  });
});

describe("wakeDecision", () => {
  it("starts only from Asleep, for a member the server is open for", () => {
    const open = { member: true, openFor: true };
    expect(wakeDecision({ ...open, state: "asleep" })).toBe("start");
    expect(wakeDecision({ ...open, state: "waking" })).toBe("already");
    expect(wakeDecision({ ...open, state: "online" })).toBe("awake");
    for (const s of ["off", "crashed", "unreachable"] as const) expect(wakeDecision({ ...open, state: s })).toBe(s);
    for (const s of ["starting", "stopping", "restarting"] as const) expect(wakeDecision({ ...open, state: s })).toBe("busy");
    expect(wakeDecision({ member: true, openFor: false, state: "asleep" })).toBe("not_open");
    expect(wakeDecision({ member: false, openFor: false, state: "asleep" })).toBe("not_member");
  });
});

const live = (stateCode: number, players: string[] = []): LiveStatus => ({ state: `S${stateCode}`, stateCode, availability: "offline", players, ampPlayers: players, online: [], maxPlayers: 10, cpu: 0, memMb: 0, memMaxMb: 0, tps: null, uptime: null, at: new Date().toISOString() });

function setup(o: { state?: number | null; crashed?: boolean; member?: { role: "ADMIN" | "PLAYER"; earlyAccess?: boolean } | null; live?: boolean; liveAfterMs?: number } = {}) {
  let clock = 1_000_000;
  const now = () => clock;
  const calls: string[] = [];
  const audits: Array<{ action: string; result: string; params: Record<string, unknown>; userId: string | null }> = [];
  const amp = new (class extends MockAmp {
    override async call<T>(_m?: string, method?: string): Promise<T> {
      calls.push(String(method));
      return {} as T;
    }
  })();
  const wake = new Wake(amp, async (a) => { audits.push(a as never); }, now);
  let current: LiveStatus | null = o.state === null ? null : live(o.state ?? 50);
  const poller = { fresh: () => current, lastError: o.state === null ? "AMP login failed: unknown" : null };
  const view = new ServerView({ poller: poller as never, wake, lastDown: () => (o.crashed ? "crash" : null), sleep: () => ({ on: true, delayMin: 5 }), tunnelUp: () => true, now });
  const deps: WakeDeps = { member: async () => (o.member === null ? null : { role: "PLAYER", earlyAccess: false, displayName: "Bramble09", ...(o.member ?? {}) }), live: async () => { if (o.liveAfterMs) await new Promise((r) => setTimeout(r, o.liveAfterMs)); return o.live ?? true; } };
  const f = Fastify();
  f.addHook("onRequest", serviceAuth("secret"));
  wakeRoutes(f, wake, view, deps);
  const as = (role = "PLAYER") => ({ authorization: "Bearer secret", "x-user-role": role, "x-user-id": "u1", "content-type": "application/json" });
  return { f, as, calls, audits, wake, set: (s: number | null) => { current = s === null ? null : live(s); }, tick: (ms: number) => { clock += ms; } };
}

describe("POST /server/wake", () => {
  it("wakes a sleeping server once, audited as <name> woke the server (Play)", async () => {
    const t = setup({ state: 50 });
    const r = await t.f.inject({ method: "POST", url: "/server/wake", headers: t.as(), payload: {} });
    expect([r.statusCode, r.json().result, r.json().wake.phase, r.json().wake.leftS]).toEqual([202, "started", "waking", 30]);
    expect(t.calls).toEqual(["Start"]);
    expect(t.audits).toEqual([{ userId: "u1", action: "server.wake", params: { name: "Bramble09", via: "play" }, result: "OK" }]);
  });
  it("says (app) when Deepslate Works asked: on opening, or on its Play (planner 2026-10-02)", async () => {
    const t = setup({ state: 50 });
    const r = await t.f.inject({ method: "POST", url: "/server/wake", headers: t.as(), payload: { via: "app" } });
    expect([r.statusCode, r.json().result]).toEqual([202, "started"]);
    expect(t.audits).toEqual([{ userId: "u1", action: "server.wake", params: { name: "Bramble09", via: "app" }, result: "OK" }]);
    const again = await t.f.inject({ method: "POST", url: "/server/wake", headers: t.as(), payload: { via: "app" } }); // opened, then Play pressed
    expect([again.statusCode, again.json().result]).toEqual([200, "already"]);
    expect(t.calls).toEqual(["Start"]); // one start, however often
  });
  it("never starts a switched-off or crashed server from the app either", async () => {
    for (const s of [{ state: 0 }, { state: 0, crashed: true }] as const) {
      const t = setup(s);
      const r = await t.f.inject({ method: "POST", url: "/server/wake", headers: t.as(), payload: { via: "app" } });
      expect(r.statusCode).toBe(409);
      expect(t.calls).toEqual([]);
    }
  });
  it("sends no second start while a wake runs (the debounce)", async () => {
    const t = setup({ state: 50 });
    await t.f.inject({ method: "POST", url: "/server/wake", headers: t.as(), payload: {} });
    t.set(10);
    const again = await t.f.inject({ method: "POST", url: "/server/wake", headers: t.as(), payload: {} });
    expect([again.statusCode, again.json().result]).toEqual([200, "already"]);
    expect(t.calls).toEqual(["Start"]);
  });
  it("sends one start for two requests a moment apart (R-32)", async () => {
    const t = setup({ state: 50, liveAfterMs: 5 }); // both are still asking the database when the second arrives
    const press = () => t.f.inject({ method: "POST", url: "/server/wake", headers: t.as(), payload: {} });
    const [a, b] = await Promise.all([press(), press()]);
    expect([a.json().result, b.json().result].sort()).toEqual(["already", "started"]);
    expect(t.calls).toEqual(["Start"]);
  });
  it("never starts a server that is switched off, crashed, busy or out of reach", async () => {
    for (const [o, code, err] of [[{ state: 0 }, 409, "off"], [{ state: 0, crashed: true }, 409, "crashed"], [{ state: 100 }, 409, "crashed"], [{ state: null }, 503, "unreachable"], [{ state: 10 }, 409, "busy"], [{ state: 40 }, 409, "busy"]] as const) {
      const t = setup(o);
      const r = await t.f.inject({ method: "POST", url: "/server/wake", headers: t.as(), payload: {} });
      expect([JSON.stringify(o), r.statusCode, r.json().error.code]).toEqual([JSON.stringify(o), code, err]);
      expect(t.calls).toEqual([]);
    }
  });
  it("is refused to a player the server is not open for, and to a caller who is not a member", async () => {
    const closed = setup({ state: 50, live: false });
    const r = await closed.f.inject({ method: "POST", url: "/server/wake", headers: closed.as(), payload: {} });
    expect([r.statusCode, r.json().error.code]).toEqual([403, "not_open"]);
    const early = setup({ state: 50, live: false, member: { role: "PLAYER", earlyAccess: true } });
    expect((await early.f.inject({ method: "POST", url: "/server/wake", headers: early.as(), payload: {} })).statusCode).toBe(202);
    const nobody = setup({ state: 50, member: null });
    expect((await nobody.f.inject({ method: "POST", url: "/server/wake", headers: nobody.as(), payload: {} })).json().error.code).toBe("not_member");
    const noRole = setup({ state: 50 });
    expect((await noRole.f.inject({ method: "POST", url: "/server/wake", headers: noRole.as(""), payload: {} })).json().error.code).toBe("not_member");
    for (const t of [closed, nobody, noRole]) expect(t.calls).toEqual([]);
  });
  it("leaves a running server alone", async () => {
    const t = setup({ state: 20 });
    const r = await t.f.inject({ method: "POST", url: "/server/wake", headers: t.as(), payload: {} });
    expect([r.statusCode, r.json().result]).toEqual([200, "awake"]);
    expect(t.calls).toEqual([]);
  });
});

describe("Wake", () => {
  it("is ready once AMP reports Running", async () => {
    const t = setup({ state: 50 });
    await t.wake.start("u1", "Bramble09");
    await t.wake.update(10);
    expect(t.wake.view().phase).toBe("waking");
    t.tick(25_000);
    await t.wake.update(20);
    expect(t.wake.view()).toMatchObject({ phase: "ready", by: "Bramble09" });
  });
  it("fails after three minutes without Running, and logs the failed wake", async () => {
    const t = setup({ state: 50 });
    await t.wake.start("u1", "Bramble09");
    t.tick(179_000);
    await t.wake.update(10);
    expect(t.wake.view().phase).toBe("waking");
    t.tick(2_000);
    await t.wake.update(10);
    expect(t.wake.view().phase).toBe("failed");
    expect(t.audits.at(-1)).toMatchObject({ action: "server.wake", result: "FAILED", params: { failed: true } });
    t.tick(11 * 60_000);
    expect(t.wake.view().phase).toBe("idle");
  });
});

describe("GET /status when AMP can't be reached", () => {
  it("answers 200 with server: unreachable and the reason, never offline", async () => {
    const amp = new (class extends MockAmp {
      override async getStatus(): Promise<AmpStatus> { throw new Error("AMP login failed: unknown"); }
    })();
    const wake = new Wake(amp, async () => {});
    const poller = { fresh: () => null, lastError: "AMP login failed: unknown" };
    const view = new ServerView({ poller: poller as never, wake, lastDown: () => null, sleep: () => ({ on: null, delayMin: null }), tunnelUp: () => true });
    const f = Fastify();
    f.addHook("onRequest", serviceAuth("secret"));
    statusRoutes(f, amp, poller as never, undefined, () => ({}), view);
    const r = await f.inject({ url: "/status", headers: { authorization: "Bearer secret" } });
    expect([r.statusCode, r.json().server, r.json().reason]).toEqual([200, "unreachable", "login refused"]);
  });

  const withPoller = (lastError: string | null, getStatus: () => Promise<AmpStatus>) => {
    const amp = new (class extends MockAmp {
      override getStatus(): Promise<AmpStatus> { return getStatus(); }
    })();
    const poller = { fresh: () => null, lastError };
    const view = new ServerView({ poller: poller as never, wake: new Wake(amp, async () => {}), lastDown: () => null, sleep: () => ({ on: null, delayMin: null }), tunnelUp: () => false });
    const f = Fastify();
    f.addHook("onRequest", serviceAuth("secret"));
    statusRoutes(f, amp, poller as never, undefined, () => ({}), view);
    return () => f.inject({ url: "/status", headers: { authorization: "Bearer secret" } });
  };

  it("does not ask AMP again when the poller has just failed to (R-13)", async () => {
    let asked = 0;
    const get = withPoller("AMP timeout", async () => { asked++; throw new Error("AMP timeout"); });
    const r = await get();
    expect([r.statusCode, r.json().server, r.json().reason]).toEqual([200, "unreachable", "tunnel down"]);
    expect(asked).toBe(0);
  });

  it("asks once for requests that arrive together when the poller has nothing to say (R-13)", async () => {
    let asked = 0;
    const get = withPoller(null, async () => {
      asked++;
      await new Promise((r) => setTimeout(r, 10));
      return { state: "Sleeping", stateCode: 50, players: [], maxPlayers: 20, cpu: 0, memMb: 0, memMaxMb: 6144, tps: null, uptime: "0" };
    });
    const [a, b, c] = await Promise.all([get(), get(), get()]);
    expect([a.json().server, b.json().server, c.json().server]).toEqual(["asleep", "asleep", "asleep"]);
    expect(asked).toBe(1);
    await get(); // and again once that answer has gone out
    expect(asked).toBe(2);
  });
});
