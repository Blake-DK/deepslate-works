import { describe, expect, it } from "vitest";
import { actions } from "../src/actions/registry.js";
import { readTesters, Testers, type TesterEntry } from "../src/test-mode/testers.js";
import { TESTER_BODY, testersHash } from "../src/shared/testers.js";

// docs/57, testers: the test server's half. The live site's switch makes a member linked and verified on the test
// site's database and puts them on the test instance's whitelist; off takes both away. Admins of the test site and
// names this never added are never touched.

const KANE = { uuid: "0f2a7c3e9d1b4c6a8e5f7a9b1c3d5e7f", name: "KaneFinch" };
const ROWAN = { uuid: "1a2b3c4d5e6f40718293a4b5c6d7e8f9", name: "Rowan" };
const ADMIN = { uuid: "99999999999940009999999999999999", name: "Bramble09" };

function world(o: { up?: boolean; players?: string[]; stored?: unknown; admins?: string[] } = {}) {
  const sent: string[] = [];
  const rows = new Map<string, { verified: boolean }>();
  let saved: TesterEntry[] | null = null;
  const srv = { up: o.up ?? true, players: o.players ?? [] };
  const t = new Testers({
    load: async () => o.stored ?? null,
    save: async (l) => { saved = l.map((e) => ({ ...e })); },
    isAdmin: async (uuid) => (o.admins ?? []).includes(uuid),
    admit: async (x) => { rows.set(x.uuid, { verified: true }); },
    hold: async (uuid) => { if (rows.has(uuid)) rows.set(uuid, { verified: false }); else rows.set(uuid, { verified: false }); },
    server: () => srv,
    run: async (action, input) => {
      const build = actions[action].build as (c: unknown, i: unknown) => string[];
      sent.push(...build({}, actions[action].input.parse(input)));
      return true;
    },
    log: () => {},
    now: () => new Date("2026-10-12T12:00:00Z"),
  });
  return { t, sent, rows, srv, saved: () => saved };
}

describe("a tester switched on (docs/57)", () => {
  it("is made a linked, verified member and put on the whitelist; never op", async () => {
    const w = world();
    await w.t.one({ ...KANE, on: true });
    expect(w.rows.get(KANE.uuid)).toEqual({ verified: true });
    expect(w.sent).toEqual(["whitelist add KaneFinch"]);
    expect(w.sent.some((c) => /\bop\b|deop|gamemode/.test(c))).toBe(false);
    expect(w.saved()).toEqual([{ ...KANE, on: true, at: "2026-10-12T12:00:00.000Z" }]);
  });
  it("while the test instance sleeps: the row now, the whitelist at its next start", async () => {
    const w = world({ up: false });
    await w.t.one({ ...KANE, on: true });
    expect(w.rows.get(KANE.uuid)).toEqual({ verified: true });
    expect(w.sent).toEqual([]);
    w.srv.up = true;
    await w.t.reconcile();
    expect(w.sent).toEqual(["whitelist add KaneFinch"]);
  });
  it("an admin of the test site is never touched", async () => {
    const w = world({ admins: [ADMIN.uuid] });
    await w.t.one({ ...ADMIN, on: true });
    await w.t.one({ ...ADMIN, on: false });
    await w.t.reconcile();
    expect(w.sent).toEqual([]);
    expect(w.rows.size).toBe(0);
  });
});

describe("a tester switched off", () => {
  it("off the whitelist and kicked when on the test server, and the door would hold them again", async () => {
    const w = world({ players: ["KaneFinch"] });
    await w.t.one({ ...KANE, on: true });
    await w.t.one({ ...KANE, on: false });
    // kicked in our words first: with enforce-whitelist on, the removal would kick them with the game's own
    expect(w.sent).toEqual(["whitelist add KaneFinch", "tag KaneFinch remove verified", "kick KaneFinch Your test server access was turned off.", "whitelist remove KaneFinch"]);
    expect(w.rows.get(KANE.uuid)).toEqual({ verified: false });
  });
  it("not kicked when not on it", async () => {
    const w = world({ players: ["Rowan"] });
    await w.t.one({ ...KANE, on: true });
    await w.t.one({ ...KANE, on: false });
    expect(w.sent).toEqual(["whitelist add KaneFinch", "whitelist remove KaneFinch"]);
  });
  it("while it sleeps: taken off the whitelist at its next start", async () => {
    const w = world({ up: false, stored: [{ ...KANE, on: true, at: "2026-10-11T10:00:00Z" }] });
    await w.t.one({ ...KANE, on: false });
    expect(w.sent).toEqual([]);
    w.srv.up = true;
    await w.t.reconcile();
    expect(w.sent).toEqual(["whitelist remove KaneFinch"]);
  });
  it("a name this never added is not touched", async () => {
    const w = world();
    await w.t.one({ ...ROWAN, on: false });
    await w.t.reconcile();
    expect(w.sent).toEqual([]);
    expect(w.rows.size).toBe(0);
  });
});

describe("the whole list from the live site", () => {
  it("turns on everyone in it and off everyone it turned on before who is not in it", async () => {
    const w = world({ stored: [{ ...KANE, on: true, at: "2026-10-11T10:00:00Z" }] });
    await w.t.all([ROWAN]);
    expect(w.sent).toEqual(["whitelist add Rowan", "whitelist remove KaneFinch"]);
    expect(w.t.on()).toEqual([ROWAN]);
  });
  it("the same list again changes nothing", async () => {
    const w = world();
    await w.t.all([KANE, ROWAN]);
    w.sent.length = 0;
    await w.t.all([ROWAN, KANE]);
    expect(w.sent).toEqual([]);
  });
  it("the fingerprint is null until it has come since the start, then the same as the live site's", async () => {
    const w = world({ stored: [{ ...KANE, on: true, at: "2026-10-11T10:00:00Z" }] });
    await w.t.one({ ...ROWAN, on: true });
    expect(w.t.hash()).toBeNull();
    await w.t.all([ROWAN, KANE]);
    expect(w.t.hash()).toBe(testersHash([KANE, ROWAN]));
  });
  it("a tester renamed in Minecraft is put on the whitelist by the new name", async () => {
    const w = world();
    await w.t.all([KANE]);
    w.sent.length = 0;
    await w.t.all([{ uuid: KANE.uuid, name: "KaneFinch2" }]);
    expect(w.sent).toEqual(["whitelist add KaneFinch2"]);
  });
});

describe("the list as stored, and what the live site may send", () => {
  it("anything that is not a tester entry is left out", () => {
    expect(readTesters(null)).toEqual([]);
    expect(readTesters({ uuid: "x" })).toEqual([]);
    expect(readTesters([{ ...KANE, on: true, at: "" }, { uuid: 1 }, null])).toEqual([{ ...KANE, on: true, at: "" }]);
  });
  it("one change or the whole list, names as Minecraft has them", () => {
    expect(TESTER_BODY.safeParse({ ...KANE, on: true }).success).toBe(true);
    expect(TESTER_BODY.safeParse({ testers: [KANE, ROWAN] }).success).toBe(true);
    expect(TESTER_BODY.safeParse({ testers: [] }).success).toBe(true);
    for (const bad of [{ ...KANE }, { uuid: KANE.uuid, name: "Kane Finch", on: true }, { uuid: "kane", name: "KaneFinch", on: false }, { uuid: KANE.uuid, name: "say_hi;op", on: true }]) expect(TESTER_BODY.safeParse(bad).success).toBe(false);
  });
  it("the fingerprint does not depend on the order, and differs for a different list", () => {
    expect(testersHash([KANE, ROWAN])).toBe(testersHash([ROWAN, KANE]));
    expect(testersHash([KANE])).not.toBe(testersHash([ROWAN]));
    expect(testersHash([{ ...KANE, uuid: KANE.uuid.toUpperCase() }])).toBe(testersHash([KANE]));
  });
});
