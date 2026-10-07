import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { actions, OWN_ROUTE, seasonWakeObjective } from "../src/actions/registry.js";
import { MockAmp } from "../src/amp/client.js";
import { ConsoleTail } from "../src/amp/console.js";
import { serviceAuth } from "../src/auth.js";
import { loadEnv } from "../src/env.js";
import { buildCommand } from "../src/modpack/build.js";
import { readSeasonFile } from "../src/seasons/files.js";
import { SeasonRecorder } from "../src/seasons/recorder.js";
import { memorySeasonStore } from "../src/seasons/store.js";
import { describeAction } from "../src/shared/events.js";
import { evaluate, forTestServer, type Inputs } from "../src/status/health-watch.js";
import { checkoutCommit } from "../src/test-mode/checkout.js";
import { offsetOf, SeasonClock, type StoredClock } from "../src/test-mode/clock.js";
import { readTestDoor, TEST_DOOR_DEFAULTS, testDoorInputs } from "../src/test-mode/door.js";
import { seasonDatapack, seasonSchema } from "../../../packages/modpack/src/seasons.js";

// docs/42: what TEST_MODE=1 changes in api, and, for each, that with TEST_MODE unset (the live api) nothing does.

const audits: Array<{ action: string; params: Record<string, unknown>; result: string; detail?: string | null }> = [];
vi.mock("../src/audit.js", () => ({ audit: async (a: (typeof audits)[number]) => void audits.push(a) }));
const { testRoutes, quickTimes } = await import("../src/test-mode/routes.js");
const { routerRoutes } = await import("../src/routes/router.js");
const { MockRouterDash } = await import("../src/router/client.js");

const DIR = fileURLToPath(new URL("../../../modpack/seasons", import.meta.url));
const TOKEN = "s".repeat(40);
const SUMMARY = "m".repeat(40);
const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

describe("the test clock (§7.1)", () => {
  it("off (the live api): the real time, whatever is stored, and it cannot be set", async () => {
    let real = Date.parse("2026-10-07T12:00:00Z");
    const stored: StoredClock = { pretend: "2026-12-19T19:55:00.000Z", setAt: "2026-10-07T11:00:00.000Z" };
    const c = new SeasonClock(false, { load: async () => stored, save: async () => undefined }, () => real);
    await c.load();
    expect(c.now().toISOString()).toBe("2026-10-07T12:00:00.000Z");
    const d = new Date("2026-10-01T00:00:00Z");
    expect(c.shift(d)).toBe(d);
    await expect(c.set(new Date("2026-12-01T00:00:00Z"))).rejects.toThrow(/test server only/);
    expect(c.view()).toMatchObject({ on: false, pretending: false, pretendSince: null });
    real += 60_000;
    expect(c.now().toISOString()).toBe("2026-10-07T12:01:00.000Z");
  });

  it("on: pretends from the set time and runs on; shifts the game's times; clears; survives a restart", async () => {
    let real = Date.parse("2026-10-07T12:00:00Z");
    let saved: StoredClock | null = null;
    const store = { load: async () => saved, save: async (v: StoredClock | null) => void (saved = v) };
    const c = new SeasonClock(true, store, () => real);
    await c.load();
    expect(c.pretending).toBe(false);
    await c.set(new Date("2026-12-19T19:55:00Z"));
    expect(c.now().toISOString()).toBe("2026-12-19T19:55:00.000Z");
    real += 5 * 60_000; // five minutes later the finale's 20:00 has come
    expect(c.now().toISOString()).toBe("2026-12-19T20:00:00.000Z");
    expect(c.shift(new Date("2026-10-07T12:01:00Z")).toISOString()).toBe("2026-12-19T19:56:00.000Z");
    const again = new SeasonClock(true, store, () => real); // api restarted
    await again.load();
    expect(again.now().toISOString()).toBe("2026-12-19T20:00:00.000Z");
    await c.clear();
    expect(saved).toBeNull();
    expect(c.now().toISOString()).toBe("2026-10-07T12:05:00.000Z");
    expect(offsetOf({ pretend: "nonsense", setAt: "2026-10-07T12:00:00Z" })).toBe(0);
  });

  it("the recorder's safety net reads the game's times on the season's clock", async () => {
    const file = (await readSeasonFile(DIR, "sample"))!;
    const uuid = "11111111-1111-4111-8111-111111111111";
    const store = memorySeasonStore([{ id: file.id, name: file.name, startsAt: new Date(file.startsAt), endsAt: new Date(file.endsAt), state: "running", marks: {}, result: null }], [{ mcUuid: uuid, mcName: "Bramble09", userId: "u1" }]);
    // killed today, in October: before the sample season opens, so on live it is not counted
    const files = { [uuid]: { "deepslate:sample/boss/rehearsal_ravager": { criteria: { kill: "2026-10-07 12:00:00 +0000" }, done: true } } };
    const make = (shift?: (d: Date) => Date) => new SeasonRecorder({ file: async () => file, store, uuidOf: async () => uuid, addEvent: async () => undefined, advancements: async () => async (u) => files[u] ?? null, log: () => {}, seasonTime: shift, later: () => {} });
    await make().fromFiles();
    expect(store.rows).toHaveLength(0);
    const clock = new SeasonClock(true, null, () => Date.parse("2026-10-07T12:30:00Z"));
    await clock.set(new Date("2026-11-24T20:30:00Z"));
    await make(clock.shift).fromFiles();
    expect(store.rows.map((r) => [r.itemId, r.at.toISOString()])).toEqual([["rehearsal_ravager", "2026-11-24T20:00:00.000Z"]]);
  });
});

describe("the test server's door (T8)", () => {
  it("Play first, vote first and the newest app are off until switched on", () => {
    expect(readTestDoor(undefined)).toEqual(TEST_DOOR_DEFAULTS);
    expect(readTestDoor({ playFirst: "yes", mustVote: 1 })).toEqual(TEST_DOOR_DEFAULTS);
    const live = { requirePlay: true, minInstaller: "3.5.5", unvoted: 2 };
    expect(testDoorInputs(TEST_DOOR_DEFAULTS, live)).toEqual({ requirePlay: false, minInstaller: "", unvoted: 0 });
    expect(testDoorInputs({ playFirst: true, mustVote: true, newestApp: true }, live)).toEqual(live);
    expect(testDoorInputs({ playFirst: true, mustVote: false, newestApp: false }, { ...live, requirePlay: false }).requirePlay).toBe(false);
  });
});

describe("the health watch on the test server (T7)", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const inputs: Inputs = { dump: null, copied: null, backups: [], pack: { site: "1.0.0+aaaaaaaa", server: "1.0.0+bbbbbbbb" }, wake: { failed: false, by: null, at: null } };
  it("expects no dump, no copy and no world backup there; the pack is looked at as on live", () => {
    const t = forTestServer(evaluate(inputs, now));
    expect([t.dump.ok, t.dumpCopy.ok, t.backup.ok]).toEqual([null, null, null]);
    expect(t.pack.ok).toBe(false);
  });
  it("unset changes nothing: on live the same inputs are alarms", () => {
    const live = evaluate(inputs, now);
    expect([live.dump.ok, live.backup.ok]).toEqual([false, false]);
  });
});

describe("the build on the test server (T5, T6)", () => {
  const base = { API_SERVICE_TOKEN: TOKEN, DATABASE_URL: "postgresql://x:y@localhost:5432/z", SEASONS_SHIP: "s1" };
  it("passes TEST_MODE and SEASONS_SHIP to the CLI only on the test server", () => {
    const test = buildCommand(loadEnv({ ...base, TEST_MODE: "1" }), "all").env;
    expect(test).toMatchObject({ TEST_MODE: "1", SEASONS_SHIP: "s1" });
  });
  it("unset changes nothing: the live CLI gets neither, even with SEASONS_SHIP in api's environment", () => {
    const live = buildCommand(loadEnv(base), "all").env;
    expect(live.TEST_MODE).toBeUndefined();
    expect(live.SEASONS_SHIP).toBeUndefined();
    expect(loadEnv({ API_SERVICE_TOKEN: TOKEN, DATABASE_URL: "x" }).TEST_MODE).toBe("0");
  });
});

describe("Reset's commands (§7.2)", () => {
  it("take back what the season's datapack gives: its tree, its tags, its score", async () => {
    const raw = JSON.parse(await readFile(path.join(DIR, "sample.json"), "utf8")) as unknown;
    const season = seasonSchema.parse(raw);
    const pack = [...seasonDatapack(season).values()].join("\n");
    const cmds = actions["season.testReset"].build({ limbo: { dimension: "minecraft:overworld", x: 0, y: 0, z: 0 }, spawn: null, portalUrl: "https://x" }, { season: season.id, bosses: season.bosses.map((b) => b.id) });
    expect(cmds[0]).toBe("advancement revoke @a from deepslate:sample/root");
    expect(Object.keys(Object.fromEntries(seasonDatapack(season)))).toContain("data/deepslate/advancement/sample/root.json");
    for (const b of season.bosses) {
      expect(cmds).toContain(`tag @a remove dw.sample.t.${b.id}`);
      expect(pack).toContain(`tag @s add dw.sample.t.${b.id}`);
    }
    expect(cmds).toContain("tag @a remove dw.sample.woke");
    expect(pack).toContain("tag @s add dw.sample.woke");
    expect(cmds).toContain(`scoreboard players reset * ${seasonWakeObjective("sample")}`);
    expect(pack).toContain(`scoreboard objectives add ${seasonWakeObjective("sample")} dummy`);
    expect(actions["season.testReset"].input.safeParse({ season: "sample; op @a", bosses: [] }).success).toBe(false);
    expect(OWN_ROUTE.has("season.testReset")).toBe(true);
    expect(describeAction("season.testReset", { name: "Alex", role: "ADMIN" }, { name: "Sample Season", clears: 3 })).toBe("Alex reset the season test of Sample Season: 3 ticks taken back");
  });
});

describe("the checkout's commit (§5.3)", () => {
  it("reads HEAD, a branch's own file, packed-refs and a detached head; null for anything else", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "checkout-"));
    dirs.push(repo);
    const git = path.join(repo, ".git");
    await mkdir(path.join(git, "refs", "heads"), { recursive: true });
    const a = "a".repeat(40), b = "b".repeat(40), c = "c".repeat(40);
    await writeFile(path.join(git, "HEAD"), "ref: refs/heads/dev\n");
    await writeFile(path.join(git, "packed-refs"), `# pack-refs with: peeled\n${b} refs/heads/dev\n`);
    expect(await checkoutCommit(repo)).toBe(b);
    await writeFile(path.join(git, "refs", "heads", "dev"), `${a}\n`);
    expect(await checkoutCommit(repo)).toBe(a);
    await writeFile(path.join(git, "HEAD"), `${c}\n`);
    expect(await checkoutCommit(repo)).toBe(c);
    await writeFile(path.join(git, "HEAD"), "ref: refs/heads/../../config\n");
    expect(await checkoutCommit(repo)).toBeNull();
    expect(await checkoutCommit(path.join(repo, "nothing"))).toBeNull();
  });
});

async function server(on: boolean, opts: { state?: number; online?: string[]; clears?: Array<{ name: string; uuid: string }> } = {}) {
  const file = (await readSeasonFile(DIR, "sample"))!;
  const sent: string[] = [];
  const amp = new (class extends MockAmp {
    override async call<T>(_m?: string, method?: string, params?: Record<string, unknown>): Promise<T> {
      if (method === "SendConsoleMessage") sent.push(String(params?.message));
      return {} as T;
    }
  })();
  const tail = new ConsoleTail(amp, () => {});
  tail.state = opts.state ?? 20;
  for (const n of opts.online ?? []) tail.online.add(n);
  const store = memorySeasonStore([{ id: file.id, name: file.name, startsAt: new Date(file.startsAt), endsAt: new Date(file.endsAt), state: "running", marks: {}, result: null }]);
  for (const c of opts.clears ?? []) await store.addClears(file.id, [{ kind: "boss", itemId: "rehearsal_ravager", mcUuid: c.uuid, mcName: c.name, userId: null, at: new Date("2026-11-24T20:00:00Z"), early: false, source: "console" }]);
  let saved: StoredClock | null = null;
  const clock = new SeasonClock(on, { load: async () => saved, save: async (v) => void (saved = v) });
  let door: unknown = null;
  const dropped: string[] = [];
  let forgot = 0;
  const f = Fastify();
  f.addHook("onRequest", serviceAuth(TOKEN, on ? { "/test/summary": SUMMARY } : {}));
  testRoutes(f, {
    on, amp, tail, ctx: () => ({ limbo: { dimension: "minecraft:overworld", x: 0, y: 0, z: 0 }, spawn: null, portalUrl: "https://x" }), clock, file: async () => file, store,
    server: () => ({ state: "online", players: [...tail.online] }), address: "lab.dsw.test",
    commits: async () => ({ images: "a".repeat(40), checkout: "b".repeat(40) }), pack: async () => ({ site: "1.0.0+aaaaaaaa", server: "1.0.0+aaaaaaaa" }),
    door: { load: async () => door, save: async (d) => void (door = d) },
    dropSeason: async (id) => void dropped.push(id), forget: () => void (forgot += 1),
  });
  const as = (role: string) => ({ authorization: `Bearer ${TOKEN}`, "x-user-role": role, "x-user-id": "u1", "content-type": "application/json" });
  const post = async (url: string, payload: object, role = "ADMIN") => {
    const r = await f.inject({ method: "POST", url, headers: as(role), payload });
    return { status: r.statusCode, body: r.json() as { ok?: boolean; error?: { code: string; message: string }; clock?: { pretending: boolean; now: string } } };
  };
  return { f, sent, post, as, clock, dropped, forgot: () => forgot, door: () => door, file };
}

describe("the test routes", () => {
  beforeEach(() => void audits.splice(0));

  it("unset changes nothing: on live every one of them is 404 and does nothing", async () => {
    const t = await server(false);
    for (const url of ["/test/summary", "/test/state"]) expect((await t.f.inject({ method: "GET", url, headers: t.as("ADMIN") })).statusCode).toBe(404);
    expect((await t.f.inject({ method: "GET", url: "/test/summary", headers: { authorization: `Bearer ${SUMMARY}` } })).statusCode).toBe(401);
    for (const [url, body] of [["/test/clock", { at: "2026-12-19T19:55:00Z" }], ["/test/door", { playFirst: true, mustVote: true, newestApp: true }], ["/test/season-reset", { season: "sample" }]] as const) {
      expect((await t.post(url, body)).status).toBe(404);
    }
    expect(t.sent).toEqual([]);
    expect(t.dropped).toEqual([]);
    expect(t.clock.now().getFullYear()).toBe(new Date().getFullYear());
  });

  it("T9: the summary answers the live site's token only, and that token opens nothing else", async () => {
    const t = await server(true, { online: ["Bramble09"] });
    const summary = await t.f.inject({ method: "GET", url: "/test/summary", headers: { authorization: `Bearer ${SUMMARY}` } });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ state: "online", players: ["Bramble09"], address: "lab.dsw.test", images: "a".repeat(40), checkout: "b".repeat(40), season: { id: "sample", state: "running" }, clock: { pretending: false } });
    expect((await t.f.inject({ method: "GET", url: "/test/summary", headers: { authorization: `Bearer ${TOKEN}` } })).statusCode).toBe(401);
    expect((await t.f.inject({ method: "GET", url: "/test/state", headers: { authorization: `Bearer ${SUMMARY}` } })).statusCode).toBe(401);
    expect((await t.f.inject({ method: "POST", url: "/test/clock", headers: { authorization: `Bearer ${SUMMARY}`, "x-user-role": "ADMIN", "x-user-id": "u1" }, payload: { clear: true } })).statusCode).toBe(401);
  });

  it("the clock: admins only, set, then back to the real time, each audited", async () => {
    const t = await server(true);
    expect((await t.post("/test/clock", { at: "2026-12-19T19:55:00Z" }, "PLAYER")).status).toBe(403);
    expect((await t.post("/test/clock", { at: "1999-01-01T00:00:00Z" })).status).toBe(400);
    const set = await t.post("/test/clock", { at: "2026-12-19T19:55:00Z" });
    expect(set.body.clock?.pretending).toBe(true);
    expect(Math.abs(Date.parse(set.body.clock!.now) - Date.parse("2026-12-19T19:55:00Z"))).toBeLessThan(5_000);
    const state = (await t.f.inject({ method: "GET", url: "/test/state", headers: t.as("ADMIN") })).json() as { clock: { pretending: boolean }; season: { quick: { finale: string | null } } };
    expect(state.clock.pretending).toBe(true);
    expect((await t.post("/test/clock", { clear: true })).body.clock?.pretending).toBe(false);
    expect(audits.map((a) => [a.action, a.result])).toEqual([["test.clock", "OK"], ["test.clock", "OK"]]);
  });

  it("the door's switches: admins only, saved as given", async () => {
    const t = await server(true);
    expect((await t.post("/test/door", { playFirst: true, mustVote: false, newestApp: false }, "PLAYER")).status).toBe(403);
    expect((await t.post("/test/door", { playFirst: true, mustVote: false, newestApp: false })).status).toBe(200);
    expect(readTestDoor(t.door())).toEqual({ playFirst: true, mustVote: false, newestApp: false });
  });

  it("Reset: only the current season, only with the server up and everyone with a tick on it", async () => {
    const anna = { name: "Bramble09", uuid: "11111111-1111-4111-8111-111111111111" };
    const ben = { name: "m1_owl", uuid: "22222222-2222-4222-8222-222222222222" };
    const down = await server(true, { state: 0, clears: [anna] });
    expect((await down.post("/test/season-reset", { season: "sample" })).body.error?.message).toMatch(/Start the test server first/);
    const away = await server(true, { online: ["Bramble09"], clears: [anna, ben] });
    expect((await away.post("/test/season-reset", { season: "sample" })).body.error?.message).toMatch(/^m1_owl has ticks in .* and is not on the server/);
    expect((await away.post("/test/season-reset", { season: "s1" })).body.error?.code).toBe("not_now");
    expect((await away.post("/test/season-reset", { season: "sample" }, "PLAYER")).status).toBe(403);
    expect(away.sent).toEqual([]);
    expect(away.dropped).toEqual([]);

    const t = await server(true, { online: ["Bramble09", "m1_owl"], clears: [anna, ben] });
    await t.clock.set(new Date("2026-12-19T19:55:00Z"));
    const r = await t.post("/test/season-reset", { season: "sample" });
    expect(r.body).toMatchObject({ ok: true, cleared: 2 });
    expect(t.sent[0]).toBe("advancement revoke @a from deepslate:sample/root");
    expect(t.sent).toContain("tag @a remove dw.sample.t.rehearsal_ravager");
    expect(t.dropped).toEqual(["sample"]);
    expect(t.forgot()).toBe(1);
    expect(t.clock.pretending).toBe(false);
    expect(audits.at(-1)).toMatchObject({ action: "season.testReset", result: "OK", params: { season: "sample", clears: 2 } });
  });

  it("the quick buttons: opening night, the next drop after the season's time now, five minutes before the finale", async () => {
    const s1 = (await readSeasonFile(DIR, "s1"))!;
    const q = quickTimes(s1, new Date(s1.startsAt));
    expect(q.opening).toBe(s1.startsAt);
    expect(Date.parse(q.nextDrop!)).toBeGreaterThan(Date.parse(s1.startsAt));
    expect(Date.parse(s1.finale!.at) - Date.parse(q.finale!)).toBe(5 * 60_000);
    expect(quickTimes(s1, new Date(s1.endsAt)).nextDrop).toBeNull();
  });
});

describe("mc-router from the test server", () => {
  it("is read only there: adding or removing an address is refused, and audited", async () => {
    audits.splice(0);
    const f = Fastify();
    f.addHook("onRequest", serviceAuth(TOKEN));
    routerRoutes(f, new MockRouterDash(), "lab.dsw.test", true);
    const h = { authorization: `Bearer ${TOKEN}`, "x-user-role": "ADMIN", "x-user-id": "u1", "content-type": "application/json" };
    expect((await f.inject({ method: "GET", url: "/router", headers: h })).statusCode).toBe(200);
    const add = await f.inject({ method: "POST", url: "/router/routes", headers: h, payload: { hostname: "x.dsw.test", port: 25570 } });
    expect([add.statusCode, (add.json() as { error: { code: string } }).error.code]).toEqual([409, "test_server"]);
    const noBody = { authorization: h.authorization, "x-user-role": "ADMIN", "x-user-id": "u1" };
    expect((await f.inject({ method: "DELETE", url: "/router/routes/mc.dsw.test", headers: noBody })).statusCode).toBe(409);
    expect(audits.map((a) => [a.action, a.result, a.params.hostname])).toEqual([["router.routeAdd", "DENIED", "x.dsw.test"], ["router.routeRemove", "DENIED", "mc.dsw.test"]]);
    expect(describeAction("router.routeRemove", { name: "Alex", role: "ADMIN" }, audits[1]!.params, "DENIED")).toBe("Alex tried to remove the game address mc.dsw.test from the test site, which never changes mc-router (refused)");
  });
});
