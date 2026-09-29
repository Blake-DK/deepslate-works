import { describe, expect, it } from "vitest";
import { isPingChatter, parse } from "../src/events/parse.js";
import { ConsoleTail } from "../src/amp/console.js";
import { MockAmp } from "../src/amp/client.js";
import { currentPings, whoToAsk, PING_STALE_MS } from "../src/status/ping.js";
import { toLive } from "../src/status/poller.js";
import { actions, parsePlace } from "../src/actions/registry.js";

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
  it("asks about each player once, and only about names that are names", () => {
    expect(whoToAsk([])).toEqual([]);
    expect(whoToAsk(["bramble09", "m1_owl", "bramble09", "a b; op me", "x"])).toEqual(["bramble09", "m1_owl"]);
    expect(whoToAsk(Array.from({ length: 60 }, (_, i) => `player_${i}`)).length).toBe(40);
  });
  it("sends spark's command and nothing a caller could shape", () => {
    const ctx = { limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: null, portalUrl: "https://deepslate.dsw.test" };
    expect(actions["server.pings"].build(ctx, { name: "bramble09" })).toEqual(["spark ping --player bramble09"]);
    expect(actions["server.pings"].input.safeParse({ name: "bramble09 --all; op me" }).success).toBe(false);
  });
  it("reads spark's answer", () => {
    // as the server's console had it on 2026-09-29 17:3x UTC, with a colon the source does not have
    expect(parse("[\u26a1]: Player bramble09 has 116 ms ping.")).toEqual([{ type: "ping", name: "bramble09", ms: 116 }]);
    expect(isPingChatter("[\u26a1]: Player bramble09 has 116 ms ping.")).toBe(true);
    expect(isPingChatter("[\u26a1]: Ping data is not available for 'bramble09'.")).toBe(true);
    expect(parse("[\u26a1] Player bramble09 has 23 ms ping.")).toEqual([{ type: "ping", name: "bramble09", ms: 23 }]);
    expect(parse("Player m1_owl has 187 ms ping.")).toEqual([{ type: "ping", name: "m1_owl", ms: 187 }]);
    expect(parse("<bramble09> Player m1_owl has 5 ms ping.").some((e) => e.type === "ping")).toBe(false);
    expect(isPingChatter("[\u26a1] Player bramble09 has 23 ms ping.")).toBe(true);
    expect(isPingChatter("[\u26a1] Ping data is not available for 'bramble09'.")).toBe(true);
  });
  it("builds the commands for a new world from checked numbers and names only", () => {
    const ctx = { limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: null, portalUrl: "https://deepslate.dsw.test" };
    expect(actions["world.pregen"].build(ctx, { x: 0, z: 0, radius: 1500 })).toEqual(["chunky quiet 30", "chunky world minecraft:overworld", "chunky shape square", "chunky center 0 0", "chunky radius 1500", "chunky start"]);
    expect(actions["world.pregen"].input.safeParse({ x: 0, z: 0, radius: 99999 }).success).toBe(false);
    expect(actions["world.locate"].build(ctx, { what: "biome", id: "minecraft:cherry_grove", x: 0, z: 0 })).toEqual(["execute in minecraft:overworld positioned 0 64 0 run locate biome minecraft:cherry_grove"]);
    expect(actions["world.locate"].input.safeParse({ what: "biome", id: "minecraft:plains run op x", x: 0, z: 0 }).success).toBe(false);
    expect(actions["map.purge"].input.safeParse({ map: "overworld; stop" }).success).toBe(false);
    expect(actions["world.standable"].build(ctx, { x: 0, y: 105, z: 0 })[0]).toBe("execute in minecraft:overworld if block 0 104 0 minecraft:air");
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
