import { describe, expect, it } from "vitest";
import { fillAddresses, matchLogin, type AddressStore, type OpenSession } from "../src/router/addresses.js";
import { MockRouterDash, toLogins, type RouterLoginEvent } from "../src/router/client.js";

// Where game sessions came from: mc-router's login with the player's real address, matched to the session the console
// opened (the game server itself only sees mc-router's local address).

const UUID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const at = (iso: string) => new Date(iso);
const login = (o: Partial<RouterLoginEvent> & { at: string }): RouterLoginEvent => ({ id: 1, player: "Bramble09", uuid: UUID, client: "203.0.113.20", server: "mc.dsw.test", ok: true, ...o });
const session: OpenSession = { id: "s1", mcUuid: UUID, mcName: "Bramble09", joinedAt: at("2026-10-07T12:00:40Z") };

describe("matchLogin", () => {
  it("takes the same player's login on our address shortly before the join", () => {
    const l = login({ at: "2026-10-07T12:00:05Z" });
    expect(matchLogin(session, [l], "mc.dsw.test")).toBe(l);
  });
  it("matches the UUID with or without dashes, and by name when the dashboard has no UUID", () => {
    expect(matchLogin(session, [login({ at: "2026-10-07T12:00:05Z", uuid: UUID.replace(/-/g, "").toUpperCase() })], "mc.dsw.test")).not.toBeNull();
    expect(matchLogin(session, [login({ at: "2026-10-07T12:00:05Z", uuid: null, player: "bramble09" })], "mc.dsw.test")).not.toBeNull();
  });
  it("never takes another player's login, even with the same name", () => {
    expect(matchLogin(session, [login({ at: "2026-10-07T12:00:05Z", uuid: "11111111-2222-3333-4444-555555555555" })], "mc.dsw.test")).toBeNull();
    expect(matchLogin(session, [login({ at: "2026-10-07T12:00:05Z", uuid: null, player: "m1_owl" })], "mc.dsw.test")).toBeNull();
  });
  it("only logins that were passed on, on the Deepslate address, within the window", () => {
    expect(matchLogin(session, [login({ at: "2026-10-07T12:00:05Z", ok: false })], "mc.dsw.test")).toBeNull();
    expect(matchLogin(session, [login({ at: "2026-10-07T12:00:05Z", server: "vanilla.dsw.test" })], "mc.dsw.test")).toBeNull();
    expect(matchLogin(session, [login({ at: "2026-10-07T11:50:00Z" })], "mc.dsw.test")).toBeNull(); // ten minutes before
    expect(matchLogin(session, [login({ at: "2026-10-07T12:03:00Z" })], "mc.dsw.test")).toBeNull(); // after the join
    expect(matchLogin(session, [login({ at: "2026-10-07T12:00:05Z", client: null })], "mc.dsw.test")).toBeNull();
  });
  it("with no server address set, any route counts; the closest login wins", () => {
    const near = login({ id: 2, at: "2026-10-07T12:00:30Z", client: "203.0.113.21", server: "other.dsw.test" });
    expect(matchLogin(session, [login({ at: "2026-10-07T11:57:00Z" }), near], null)).toBe(near);
  });
});

describe("fillAddresses", () => {
  function store(sessions: OpenSession[]) {
    const set: Array<[string, string, string | null]> = [];
    const asked: Date[] = [];
    const s: AddressStore = {
      unfilled: async (since) => { asked.push(since); return sessions.filter((x) => x.joinedAt >= since); },
      setAddress: async (id, ip, country) => void set.push([id, ip, country]),
    };
    return { s, set, asked };
  }
  const now = at("2026-10-07T13:00:00Z");

  it("fills what matches, with the country only while location is on", async () => {
    const dash = new MockRouterDash();
    dash.logins = [login({ at: "2026-10-07T12:00:05Z" })];
    const other: OpenSession = { id: "s2", mcUuid: "name:KaneFinch", mcName: "KaneFinch", joinedAt: at("2026-10-07T12:30:00Z") };
    const a = store([session, other]);
    expect(await fillAddresses({ dash, store: a.s, host: "mc.dsw.test", ipDays: 30, geo: true, country: async () => "GB", now })).toBe(1);
    expect(a.set).toEqual([["s1", "203.0.113.20", "GB"]]);
    expect(a.asked[0]).toEqual(at("2026-09-07T13:00:00Z"));

    const b = store([session]);
    await fillAddresses({ dash, store: b.s, host: "mc.dsw.test", ipDays: 30, geo: false, country: async () => "GB", now });
    expect(b.set).toEqual([["s1", "203.0.113.20", null]]);
  });

  it("asks the dashboard nothing when every session has an address", async () => {
    const dash = new MockRouterDash();
    let asked = 0;
    dash.loginsSince = async () => { asked++; return []; };
    expect(await fillAddresses({ dash, store: store([]).s, host: null, ipDays: 30, geo: true, country: async () => null, now })).toBe(0);
    expect(asked).toBe(0);
  });
});

describe("toLogins", () => {
  it("reads the dashboard's events and drops ones without an id or time", () => {
    expect(toLogins({ events: [
      { id: 9, ts: "2026-10-07T11:50:00Z", event: "connect", status: "success", kind: "login", client_host: "203.0.113.20", server: "mc.dsw.test", player_name: "Bramble09", player_uuid: UUID, error: null },
      { id: 8, ts: "2026-10-07T11:49:00Z", event: "connect", status: "failed-backend-connection", kind: "login", client_host: "203.0.113.21", server: "boys.dsw.test", player_name: "Rowan", player_uuid: null, error: "refused" },
      { ts: "2026-10-07T11:48:00Z", status: "success" },
    ] })).toEqual([
      { id: 9, at: "2026-10-07T11:50:00Z", player: "Bramble09", uuid: UUID, client: "203.0.113.20", server: "mc.dsw.test", ok: true },
      { id: 8, at: "2026-10-07T11:49:00Z", player: "Rowan", uuid: null, client: "203.0.113.21", server: "boys.dsw.test", ok: false },
    ]);
  });
});
