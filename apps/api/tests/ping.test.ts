import { describe, expect, it } from "vitest";
import { isPingChatter, parse } from "../src/events/parse.js";
import { ConsoleTail } from "../src/amp/console.js";
import { MockAmp } from "../src/amp/client.js";
import { currentPings, pagesFor, PING_STALE_MS } from "../src/status/ping.js";
import { toLive } from "../src/status/poller.js";
import { actions, parsePos } from "../src/actions/registry.js";

// What TabTPS prints for `pingall` (PingCommand.pingMultiple): an empty line, a header, one line for each player,
// an empty line, the average.

describe("ping lines", () => {
  it("reads a player's ping, with and without what the log puts in front", () => {
    expect(parse(" - bramble09: 23ms")).toEqual([{ type: "ping", name: "bramble09", ms: 23 }]);
    expect(parse("[10:00:00] [Server thread/INFO] [minecraft/MinecraftServer]:  - m1_owl: 187ms")).toEqual([{ type: "ping", name: "m1_owl", ms: 187 }]);
    expect(parse("- bramble09: 0ms")).toEqual([{ type: "ping", name: "bramble09", ms: 0 }]);
  });
  it("takes nothing a player types for one", () => {
    expect(parse("<bramble09> - m1_owl: 5ms")).toEqual([{ type: "chat", name: "bramble09", text: "- m1_owl: 5ms" }]);
    expect(parse("[Server] - m1_owl: 5ms")).toEqual([]);
    expect(parse(" - m1_owl: fastms")).toEqual([]);
    expect(parse(" - not a name!: 5ms")).toEqual([]);
  });
  it("knows what a round prints, so that it can be kept off the console page", () => {
    for (const l of [" - bramble09: 23ms", "Average ping: 23ms (1 player)", "Average ping: 80ms (12 players)", "-------- TabTPS Player Pings --------", "[TabTPS] Player Pings"]) expect([l, isPingChatter(l)]).toEqual([l, true]);
    for (const l of ["bramble09 joined the game", "<bramble09> what is my ping", "Overworld: 20.000 TPS (3.133 ms/tick)", "Done (1.2s)!"]) expect([l, isPingChatter(l)]).toEqual([l, false]);
  });
  it("reaches whoever listens to the console, and stays out of the lines that are kept", () => {
    const tail = new ConsoleTail(new MockAmp(), () => {});
    const seen: Array<[string, number]> = [];
    tail.on((e) => { if (e.type === "ping") seen.push([e.name, e.ms]); });
    tail.ingest("bramble09 joined the game");
    tail.ingest(" - bramble09: 41ms");
    tail.ingest("Average ping: 41ms (1 player)");
    expect(seen).toEqual([["bramble09", 41]]);
    expect(tail.lines).toEqual(["bramble09 joined the game"]);
  });
});

describe("ping rounds", () => {
  it("asks for as many pages as there are players to fill", () => {
    expect(pagesFor(0)).toEqual([]);
    expect(pagesFor(1)).toEqual([1]);
    expect(pagesFor(10)).toEqual([1]);
    expect(pagesFor(11)).toEqual([1, 2]);
    expect(pagesFor(20)).toEqual([1, 2]);
  });
  it("sends `pingall` and nothing a caller could shape", () => {
    const ctx = { limbo: parsePos("0 250 0"), spawn: null, portalUrl: "https://deepslate.dsw.test" };
    expect(actions["server.pings"].build(ctx, { page: 1 })).toEqual(["pingall"]);
    expect(actions["server.pings"].build(ctx, { page: 2 })).toEqual(["pingall 2"]);
    expect(actions["server.pings"].input.safeParse({ page: "1; op me" }).success).toBe(false);
    expect(actions["server.pings"].input.safeParse({ page: 0 }).success).toBe(false);
  });
  it("shows a ping only while it is recent and its player is here", () => {
    const now = 1_000_000;
    const all = new Map([["a_player", { ms: 20, at: now - 1000 }], ["gone_home", { ms: 30, at: now - 1000 }], ["went_quiet", { ms: 40, at: now - PING_STALE_MS - 1 }]]);
    expect(currentPings(all, ["a_player", "went_quiet", "never_measured"], now)).toEqual({ a_player: 20 });
  });
  it("is in the status, next to the player", () => {
    const amp = { state: "Running", stateCode: 20, players: ["bramble09", "m1_owl"], maxPlayers: 20, cpu: 1, memMb: 1, memMaxMb: 2, tps: 20, uptime: "0" };
    const live = toLive(amp, { online: new Set<string>(), uuidByName: new Map([["bramble09", "c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10"]]) }, new Date(), { bramble09: 23 });
    expect(live.online).toEqual([{ name: "bramble09", uuid: "c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10", ping: 23 }, { name: "m1_owl", uuid: null, ping: null }]);
  });
});
