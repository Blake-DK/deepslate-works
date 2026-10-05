import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { parse } from "../src/events/parse.js";
import { actions, ADMIN_ACTIONS, OWN_ROUTE } from "../src/actions/registry.js";
import { MockAmp } from "../src/amp/client.js";
import { ConsoleTail } from "../src/amp/console.js";
import { serviceAuth } from "../src/auth.js";
import type { NewEvent } from "../src/events/recorder.js";
import { seasonRoutes } from "../src/routes/seasons.js";
import { readSeasonFile } from "../src/seasons/files.js";
import { SeasonRecorder } from "../src/seasons/recorder.js";
import { memorySeasonStore } from "../src/seasons/store.js";
import { describeAction } from "../src/shared/events.js";
import type { SeasonResult } from "../src/shared/season.js";

// docs/34 §6 (W1.4): Admin → Seasons. Announce, start, end (once), and a tick given or taken back by hand.

const DIR = fileURLToPath(new URL("../../../modpack/seasons", import.meta.url));
const ctx = { limbo: { dimension: "minecraft:overworld", x: 0, y: 0, z: 0 }, spawn: null, portalUrl: "https://x" };
const members = [
  { mcUuid: "11111111-1111-4111-8111-111111111111", mcName: "Anna", userId: "u-anna" },
  { mcUuid: "22222222-2222-4222-8222-222222222222", mcName: "Ben", userId: "u-ben" },
];

async function app(online: string[] = []) {
  const file = await readSeasonFile(DIR, "sample");
  if (!file) throw new Error("sample.json does not read");
  const sent: string[] = [];
  const amp = new (class extends MockAmp {
    override async call<T>(_m?: string, method?: string, params?: Record<string, unknown>): Promise<T> {
      if (method === "SendConsoleMessage") sent.push(String(params?.message));
      return {} as T;
    }
  })();
  const tail = new ConsoleTail(amp, () => {});
  tail.state = 20;
  for (const n of online) tail.online.add(n);
  const store = memorySeasonStore([], members);
  const events: NewEvent[] = [];
  const f = Fastify();
  f.addHook("onRequest", serviceAuth("secret"));
  let now = new Date("2026-11-24T20:00:00Z");
  // the recorder beside the routes, as in server.ts; its five-second timer never runs here, so only End's settle writes a waiting group
  const rec = new SeasonRecorder({ file: async () => file, store, uuidOf: async (name) => members.find((m) => m.mcName === name)?.mcUuid ?? null, addEvent: async (e) => void events.push(e), log: () => {}, now: () => now, later: () => {} });
  seasonRoutes(f, { amp, tail, ctx: () => ctx, file: async () => file, store, addEvent: async (e) => void events.push(e), settle: () => rec.settle(), now: () => now });
  const as = (role: string) => ({ authorization: "Bearer secret", "x-user-role": role, "x-user-id": "u1", "content-type": "application/json" });
  const post = async (op: string, payload: object = {}, role = "ADMIN") => {
    const r = await f.inject({ method: "POST", url: `/seasons/${op}`, headers: as(role), payload });
    return { status: r.statusCode, body: r.json() as { ok?: boolean; added?: boolean; removed?: boolean; inGame?: boolean; error?: { code: string; message: string } } };
  };
  return { f, file, store, events, sent, post, as, rec, setNow: (d: string) => { now = new Date(d); } };
}

describe("Admin → Seasons", () => {
  it("is for admins only", async () => {
    const t = await app();
    expect((await t.post("start", {}, "PLAYER")).status).toBe(403);
    expect((await t.f.inject({ method: "GET", url: "/seasons", headers: t.as("PLAYER") })).statusCode).toBe(403);
    expect(t.store.seasons).toHaveLength(0);
  });

  it("announce, start, end: each once, in that order, each with its line", async () => {
    const t = await app();
    expect((await t.post("end")).status).toBe(409); // not running
    expect((await t.post("announce")).body).toMatchObject({ ok: true, state: "upcoming" });
    expect((await t.post("announce")).status).toBe(409);
    expect((await t.post("start")).body).toMatchObject({ ok: true, state: "running" });
    expect((await t.post("start")).status).toBe(409);
    expect((await t.post("grant", { userId: "u-anna", kind: "boss", itemId: "rehearsal_ravager" })).body).toMatchObject({ added: true, inGame: false });
    expect((await t.post("end")).body).toMatchObject({ ok: true, state: "ended" });
    expect((await t.post("end")).status).toBe(409);
    expect((await t.post("start")).status).toBe(409); // an ended season is not started again
    expect(t.events.map((e) => [e.kind, e.message])).toEqual([
      ["SEASON", "Sample Season · Dress Rehearsal is announced: it opens Mon 16 Nov, 00:00"],
      ["SEASON", "Sample Season · Dress Rehearsal has begun"],
      ["SEASON", "Sample Season · Dress Rehearsal is over. Anna wins with 20 points."],
    ]);
    const result = t.store.seasons[0]!.result as SeasonResult;
    expect(result.scoreboard.map((r) => [r.mcName, r.points])).toEqual([["Anna", 20]]);
    expect(result.endedAt).toBe("2026-11-24T20:00:00.000Z");
    expect((await t.post("grant", { userId: "u-ben", kind: "boss", itemId: "rehearsal_ravager" })).status).toBe(409); // frozen
  });

  it("a kill in the last seconds before End is in the frozen result (the group's five seconds are not waited out)", async () => {
    const t = await app();
    await t.post("start");
    const line = "[29Sep2026 03:46:07.132] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: Anna has completed the challenge [The Rehearsal Ravager]";
    for (const e of parse(line)) t.rec.onConsole(e, { replay: false });
    await t.rec.idle();
    expect(t.store.rows).toHaveLength(0); // still waiting for the rest of the group
    expect((await t.post("end")).body).toMatchObject({ ok: true, state: "ended" });
    expect((t.store.seasons[0]!.result as SeasonResult).scoreboard.map((r) => [r.mcName, r.points])).toEqual([["Anna", 20]]);
    expect(t.events.at(-1)!.message).toBe("Sample Season · Dress Rehearsal is over. Anna wins with 20 points.");
  });

  it("a second click on Announce that loses the race is refused, not an error, and says nothing twice", async () => {
    const t = await app();
    t.store.create = async () => false; // the other request made the row between this one's look and its write
    const r = await t.post("announce");
    expect([r.status, r.body.error?.message]).toEqual([409, "Sample Season · Dress Rehearsal is announced already."]);
    expect(t.events).toHaveLength(0);
  });

  it("a tick given by hand is first only when nobody had it before: given days after a kill, it is not", async () => {
    const t = await app();
    await t.post("start");
    await t.post("grant", { userId: "u-anna", kind: "boss", itemId: "rehearsal_ravager" });
    t.setNow("2026-11-26T20:00:00Z");
    await t.post("grant", { userId: "u-ben", kind: "boss", itemId: "rehearsal_ravager" });
    expect(t.store.rows.map((x) => [x.mcName, x.source, x.first])).toEqual([["Anna", "admin", true], ["Ben", "admin", false]]);
  });

  it("start without announce makes the row; a second running season is refused", async () => {
    const t = await app();
    t.store.seasons.push({ id: "other", name: "Other", startsAt: new Date(), endsAt: new Date(), state: "running", marks: {}, result: null });
    const r = await t.post("start");
    expect([r.status, r.body.error?.message]).toEqual([409, "Another season (other) is still running. End it first."]);
    t.store.seasons[0]!.state = "ended";
    expect((await t.post("start")).status).toBe(200);
  });

  it("a tick given to someone on the server is given in the game too, to them alone", async () => {
    const t = await app(["Anna"]);
    await t.post("start");
    const r = await t.post("grant", { userId: "u-anna", kind: "boss", itemId: "rehearsal_ravager" });
    expect(r.body).toMatchObject({ ok: true, added: true, inGame: true });
    // dw.credit keeps the boss's reward function from sharing the tick with whoever stands near
    expect(t.sent).toEqual(["tag Anna add dw.credit", "advancement grant Anna only deepslate:sample/boss/rehearsal_ravager", "tag Anna remove dw.credit"]);
    expect(t.store.rows.map((x) => [x.mcName, x.source, x.first])).toEqual([["Anna", "admin", true]]);
    expect((await t.post("grant", { userId: "u-anna", kind: "boss", itemId: "rehearsal_ravager" })).body).toMatchObject({ added: false });
  });

  it("only what the file and the member list hold can be named", async () => {
    const t = await app(["Anna"]);
    await t.post("start");
    expect((await t.post("grant", { userId: "u-anna", kind: "boss", itemId: "wither" })).status).toBe(404);
    expect((await t.post("grant", { userId: "nobody", kind: "boss", itemId: "rehearsal_ravager" })).status).toBe(404);
    expect((await t.post("grant", { userId: "u-anna", kind: "boss", itemId: "x y; op me" })).status).toBe(400);
    expect((await t.post("grant", { userId: "u-anna", kind: "raid", itemId: "rehearsal_ravager" })).status).toBe(400);
    expect(t.sent).toEqual([]);
  });

  it("a tick taken back stays taken back: the game's file does not return it", async () => {
    const t = await app();
    await t.post("start");
    await t.post("grant", { userId: "u-ben", kind: "trial", itemId: "rehearsal_table" });
    expect((await t.post("revoke", { userId: "u-ben", kind: "trial", itemId: "rehearsal_table" })).body).toMatchObject({ removed: true, inGame: false });
    expect(t.store.rows).toHaveLength(0);
    expect((await t.post("revoke", { userId: "u-ben", kind: "trial", itemId: "rehearsal_table" })).body).toMatchObject({ removed: false });
    const rec = new SeasonRecorder({
      file: async () => t.file, store: t.store, uuidOf: async () => null, addEvent: async () => {}, log: () => {}, now: () => new Date("2026-11-24T20:10:00Z"),
      advancements: async () => async () => ({ "deepslate:sample/trial/rehearsal_table": { criteria: { done: "2026-11-24 19:00:00 +0000" }, done: true } }),
    });
    await rec.fromFiles();
    expect(t.store.rows.map((x) => x.mcName)).toEqual(["Anna"]); // Anna's is found; Ben's was taken back
    await t.post("grant", { userId: "u-ben", kind: "trial", itemId: "rehearsal_table" }); // given again: no longer held back
    expect(t.store.seasons[0]!.marks.revoked).toEqual([]);
  });

  it("the console commands are built from checked ids, and have no generic route", () => {
    for (const n of ["season.grant", "season.revoke", "season.reload"] as const) {
      expect(ADMIN_ACTIONS).toContain(n);
      expect(OWN_ROUTE.has(n)).toBe(true);
    }
    const bad = { name: "Anna", season: "s1", kind: "boss", id: "a b" };
    expect(actions["season.grant"].input.safeParse(bad).success).toBe(false);
    expect(actions["season.revoke"].input.safeParse({ ...bad, id: "frostmaw", name: "@a" }).success).toBe(false);
    expect(actions["season.revoke"].build(ctx, { name: "Anna", season: "s1", kind: "trial", id: "iron_week" })).toEqual(["advancement revoke Anna only deepslate:s1/trial/iron_week"]);
    expect(actions["season.reload"].build(ctx, {})).toEqual(["reload"]);
  });

  it("reads plainly in the event log", () => {
    const alex = { role: "ADMIN" as const, name: "Alex" };
    expect(describeAction("season.start", alex, { name: "Season 1" })).toBe("Alex started Season 1");
    expect(describeAction("season.grant", alex, { member: "Anna", title: "Frostmaw", inGame: false })).toBe("Alex gave Anna the tick for Frostmaw on the site only: they are not on the server");
    expect(describeAction("season.revoke", alex, { member: "Anna", title: "Frostmaw", inGame: true, had: true })).toBe("Alex took the tick for Frostmaw back from Anna");
  });
});
