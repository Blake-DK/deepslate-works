import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseConsoleLine } from "../src/amp/console.js";
import { duration, Recorder, type NewEvent, type NewSession, type OpenSession, type RecorderStore } from "../src/events/recorder.js";
import type { LiveStatus } from "../src/status/poller.js";
import { describeAction, kindOf } from "../src/shared/events.js";
import { isDenied, parseSection } from "../src/shared/settings.js";

const UUID = "c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10";

function setup(opts: { chat?: boolean; geo?: boolean; users?: Record<string, string> } = {}) {
  let clock = Date.parse("2026-09-29T10:00:00Z");
  const events: Array<NewEvent & { id: string; count: number }> = [];
  const sessions: Array<NewSession & { id: string; leftAt: Date | null }> = [];
  const uuids = new Map<string, string>();
  const store: RecorderStore = {
    userIdByUuid: async (u) => (u === UUID ? "user1" : null),
    uuidByName: async (n) => opts.users?.[n] ?? sessions.find((x) => x.mcName.toLowerCase() === n.toLowerCase() && !x.mcUuid.startsWith("name:"))?.mcUuid ?? null, // as the real store: a linked member, or an earlier session
    openSessions: async () => sessions.filter((s) => !s.leftAt).map((s): OpenSession => ({ id: s.id, mcUuid: s.mcUuid, mcName: s.mcName, joinedAt: s.joinedAt, ip: s.ip })),
    openSession: async (s) => { const row = { ...s, id: `s${sessions.length + 1}`, leftAt: null }; sessions.push(row); return { id: row.id, mcUuid: s.mcUuid, mcName: s.mcName, joinedAt: s.joinedAt, ip: s.ip }; },
    closeSession: async (id, leftAt) => { const s = sessions.find((x) => x.id === id); if (s && !s.leftAt) s.leftAt = leftAt; },
    reopenSession: async (id) => { const s = sessions.find((x) => x.id === id); if (s) s.leftAt = null; },
    setSessionAddress: async (id, ip, country) => { const s = sessions.find((x) => x.id === id); if (s) { s.ip = ip; s.country = country; } },
    adoptUuid: async (name, uuid) => { for (const s of sessions) if (s.mcUuid === `name:${name.toLowerCase()}`) s.mcUuid = uuid; for (const e of events) if (e.actor === `name:${name.toLowerCase()}`) e.actor = uuid; },
    addEvent: async (e) => { const id = String(events.length + 1); events.push({ ...e, id, count: 1 }); return id; },
    bumpEvent: async (id) => { const e = events.find((x) => x.id === id); if (e) e.count++; },
  };
  const rec = new Recorder({ store, privacy: async () => ({ chat: opts.chat ?? true, geo: opts.geo ?? true }), country: async (ip) => (ip === "82.10.20.30" ? "GB" : null), uuidOf: (n) => uuids.get(n), log: () => {}, now: () => new Date(clock) });
  const say = async (line: string, meta = {}) => {
    for (const e of parseConsoleLine(line, meta, (n) => uuids.has(n) || sessions.some((s) => s.mcName === n && !s.leftAt))) {
      if (e.type === "uuid") uuids.set(e.name, e.uuid);
      rec.onConsole(e);
    }
    await rec.idle();
  };
  const status = (over: Partial<LiveStatus>): LiveStatus => ({ state: "Running", stateCode: 20, availability: "online", players: [], ampPlayers: [], online: [], maxPlayers: 20, cpu: 1, memMb: 1, memMaxMb: 6144, tps: 20, uptime: "0:00:10:00", at: new Date(clock).toISOString(), ...over });
  const poll = async (next: LiveStatus, prev: LiveStatus | null) => { rec.onStatus(next, prev); await rec.idle(); };
  return { rec, events, sessions, say, status, poll, tick: (s: number) => (clock += s * 1000) };
}
const L = (msg: string, level = "INFO") => `[29Sep2026 10:00:00.000] [Server thread/${level}] [net.minecraft.server.MinecraftServer/]: ${msg}`;

describe("Recorder: a visit from start to finish", () => {
  it("opens one session for the two join lines, records what happens, closes it on the first leave line", async () => {
    const t = setup();
    await t.say(L(`UUID of player Bramble09 is ${UUID}`));
    await t.say(L("Bramble09[/82.10.20.30:51234] logged in with entity id 12 at (0.5, 64.0, 0.5)"));
    await t.say(L("Bramble09 joined the game"));
    expect(t.sessions).toHaveLength(1);
    expect(t.sessions[0]).toMatchObject({ mcUuid: UUID, mcName: "Bramble09", userId: "user1", ip: "82.10.20.30", country: "GB", leftAt: null });
    t.tick(60);
    await t.say(L("<Bramble09> evening all"));
    await t.say(L("Bramble09 has made the advancement [Stone Age]"));
    await t.say(L("Bramble09 was slain by Zombie"));
    t.tick(45 * 60);
    await t.say(L("Bramble09 lost connection: Disconnected"));
    await t.say(L("Bramble09 left the game"));
    expect(t.events.map((e) => e.kind)).toEqual(["JOIN", "CHAT", "ADVANCEMENT", "DEATH", "LEAVE"]);
    expect(t.events.every((e) => e.actor === UUID)).toBe(true);
    expect(t.events.at(-1)).toMatchObject({ message: "Bramble09 left after 46 min", meta: { name: "Bramble09", minutes: 46, reason: "Disconnected" } });
    expect(t.sessions[0]?.leftAt?.toISOString()).toBe("2026-09-29T10:46:00.000Z");
    expect(t.rec.openCount).toBe(0);
  });
  it("never keeps an address in the event log", async () => {
    const t = setup();
    await t.say(L("m1_owl[/82.10.20.30:51234] logged in with entity id 12 at (0.5, 64.0, 0.5)"));
    expect(t.events[0]?.raw).toContain("m1_owl[address hidden] logged in");
    expect(JSON.stringify(t.events)).not.toContain("82.10.20.30");
    expect(t.sessions[0]?.ip).toBe("82.10.20.30");
  });
  it("uses a placeholder until the uuid is known, then fixes the rows", async () => {
    const t = setup();
    await t.say(L("m1_owl joined the game"));
    expect(t.sessions[0]?.mcUuid).toBe("name:m1_owl");
    await t.say(L("UUID of player m1_owl is 11111111-2222-3333-4444-555555555555"));
    expect(t.sessions[0]?.mcUuid).toBe("11111111-2222-3333-4444-555555555555");
    expect(t.events[0]?.actor).toBe("11111111-2222-3333-4444-555555555555");
  });
  it("finds the uuid of a linked member by name", async () => {
    const t = setup({ users: { Bramble09: UUID } });
    await t.say(L("Bramble09 joined the game"));
    expect(t.sessions[0]).toMatchObject({ mcUuid: UUID, userId: "user1" });
  });
  it("ignores a disconnect from someone who never got in", async () => {
    const t = setup();
    await t.say(L("stranger lost connection: You are not whitelisted on this server!"));
    expect(t.events).toEqual([]);
  });
});

describe("Recorder: settings", () => {
  it("keeps no chat when chat logging is off, and looks up no country when that is off", async () => {
    const t = setup({ chat: false, geo: false });
    await t.say(L("m1_owl[/82.10.20.30:51234] logged in with entity id 12 at (0.5, 64.0, 0.5)"));
    await t.say(L("<m1_owl> hello"));
    expect(t.events.map((e) => e.kind)).toEqual(["JOIN"]);
    expect(t.sessions[0]).toMatchObject({ ip: "82.10.20.30", country: null });
  });
});

describe("Recorder: warnings and errors", () => {
  it("counts a repeat within 60 s on the same row and starts a new row after that", async () => {
    const t = setup();
    const line = L("Can't keep up! Is the server overloaded? Running 2500ms or 50 ticks behind", "WARN");
    await t.say(line);
    t.tick(20); await t.say(line);
    t.tick(20); await t.say(line);
    t.tick(61); await t.say(line);
    await t.say(L("Something else broke", "ERROR"));
    expect(t.events.map((e) => [e.kind, e.count])).toEqual([["WARN", 3], ["WARN", 1], ["ERROR", 1]]);
  });
});

describe("Recorder: the server going up and down", () => {
  it("records sleep, a clean stop, a restart and a crash differently, and closes everyone's session", async () => {
    const t = setup();
    const online = t.status({ players: ["m1_owl"] });
    await t.say(L("m1_owl joined the game"));
    await t.poll(t.status({ state: "Sleeping", stateCode: 30, availability: "sleeping" }), online);
    expect(t.events.map((e) => e.kind)).toEqual(["JOIN", "LEAVE", "SERVER_STOP"]);
    expect(t.events.at(-1)?.message).toBe("Server asleep (nobody on)");
    expect(t.sessions[0]?.leftAt).not.toBeNull();

    await t.say(L("Stopping server"));
    t.tick(5);
    await t.poll(t.status({ state: "Stopped", stateCode: 0, availability: "offline" }), online);
    expect(t.events.at(-1)).toMatchObject({ kind: "SERVER_STOP", message: "Server switched off" });

    t.tick(600);
    await t.poll(t.status({ state: "Restarting", stateCode: 40, availability: "starting" }), online);
    expect(t.events.at(-1)).toMatchObject({ kind: "SERVER_STOP", message: "Server restarting" });

    t.tick(600);
    const gone = t.status({ state: "Stopped", stateCode: 0, availability: "offline" });
    await t.poll(gone, online);
    expect(t.events.at(-1)).toMatchObject({ message: "Server restarting" }); // not yet: no stop line may still be on its way
    t.tick(90);
    await t.poll(gone, gone);
    expect(t.events.at(-1)).toMatchObject({ kind: "CRASH", at: new Date("2026-09-29T10:20:05Z") }); // dated when it went down
  });

  // 2026-09-29 17:02 UTC, as it went: nobody on, AMP puts the server to sleep. The poller saw it gone before the
  // console tail had read the stop lines (the tail runs on its own clock and slows down once the server is not
  // running), and the row said "Crash".
  const SLEEP = [
    "Stopping the server",
    "Stopping server",
    "Saving players",
    "Saving worlds",
    "Saving chunks for level 'ServerLevel[world]'/minecraft:overworld",
    "ThreadedAnvilChunkStorage: All dimensions are saved",
  ];
  it.each([
    ["the sleep state at once", [{ state: "PreparingForSleep", stateCode: 50, availability: "sleeping" }], "Server asleep (nobody on)"],
    ["a state between, then sleep", [{ state: "Stopping", stateCode: 45, availability: "offline" }, { state: "Sleeping", stateCode: 30, availability: "sleeping" }], "Server asleep (nobody on)"],
    ["Stopped, then sleep", [{ state: "Stopped", stateCode: 0, availability: "offline" }, { state: "Sleeping", stateCode: 30, availability: "sleeping" }], "Server asleep (nobody on)"],
    ["a state between for longer than the wait", [{ state: "Stopping", stateCode: 45, availability: "offline" }, { state: "Stopping", stateCode: 45, availability: "offline" }], "Server switched off"],
  ] as const)("a sleep with the stop lines read after the poll, %s: never a crash", async (_how, states, message) => {
    const t = setup();
    let prev = t.status({});
    await t.poll(prev, null);
    t.tick(10);
    const first = t.status(states[0]);
    await t.poll(first, prev); // the poller is first
    prev = first;
    t.tick(2);
    for (const l of SLEEP) await t.say(L(l)); // then the tail
    for (const s of states.slice(1)) {
      t.tick(60);
      const n = t.status(s);
      await t.poll(n, prev);
      prev = n;
    }
    t.tick(120);
    await t.poll(prev, prev);
    expect(t.events.filter((e) => e.kind === "CRASH")).toEqual([]);
    expect(t.events.filter((e) => e.kind === "SERVER_STOP").map((e) => e.message)).toEqual([message]);
  });
  it("2026-09-30 05:26: api restarting as the server stops reads the stop line in the backlog; still a stop, not a crash", async () => {
    const t = setup();
    for (const l of ["Stopping the server", "Stopping server", "Saving players", "Saving worlds"]) {
      for (const e of parseConsoleLine(L(l), {})) t.rec.onConsole(e, { replay: true });
    }
    await t.rec.idle();
    t.tick(5);
    await t.poll(t.status({ state: "Stopped", stateCode: 0, availability: "offline" }), t.status({}));
    t.tick(120);
    await t.poll(t.status({ state: "Stopped", stateCode: 0, availability: "offline" }), t.status({ state: "Stopped", stateCode: 0, availability: "offline" }));
    expect(t.events.map((e) => e.kind)).toEqual(["SERVER_STOP"]);
  });
  it("a stop line read before the poll is enough too", async () => {
    const t = setup();
    await t.say(L("Stopping the server"));
    t.tick(3);
    await t.poll(t.status({ state: "Stopped", stateCode: 0, availability: "offline" }), t.status({}));
    expect(t.events.map((e) => [e.kind, e.message])).toEqual([["SERVER_STOP", "Server switched off"]]);
  });
  it("records the start once: from the Done line, or from the state if the line was missed", async () => {
    const t = setup();
    const asleep = t.status({ state: "Sleeping", stateCode: 30, availability: "sleeping" });
    await t.say('[29Sep2026 03:46:07.132] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer/]: Done (1.756s)! For help, type "help"');
    t.tick(5);
    await t.poll(t.status({}), asleep);
    expect(t.events.map((e) => e.message)).toEqual(["Server online (started in 1.8 s)"]);
    t.tick(3600);
    await t.poll(asleep, t.status({}));
    t.tick(3600);
    await t.poll(t.status({}), asleep);
    expect(t.events.at(-1)).toMatchObject({ kind: "SERVER_START", message: "Server online", meta: { inferred: true } });
    expect(t.events.filter((e) => e.kind === "SERVER_START")).toHaveLength(2);
  });
  it("says nothing on api's own first poll", async () => {
    const t = setup();
    await t.poll(t.status({}), null);
    expect(t.events).toEqual([]);
  });
});

// Planner, 2026-09-30: "a session starts on a real join line and ends on a real leave line (or server stop/crash/
// sleep); poll disagreements never create or end a session. A leave and rejoin within 60 s counts as one session."
describe("Recorder: sessions come from join and leave lines only", () => {
  const UUID_M1 = "9e2b7c41-0a5d-4f36-8c19-b4e07d2a6f53";
  it("2026-09-29 22:44: a player the server turned away, whom AMP kept in its list for hours, has no session at all", async () => {
    const t = setup();
    const ghost = t.status({ players: ["m1_owl"] }); // AMP's list; the console's is empty
    const nobody = "[29Sep2026 22:45:13.880] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: There are 0 of a max of 20 players online: ";
    for (let attempt = 0; attempt < 3; attempt++) {
      await t.say(`[29Sep2026 22:44:51.063] [User Authenticator #1/INFO] [net.minecraft.server.network.ServerLoginPacketListenerImpl/]: UUID of player m1_owl is ${UUID_M1}`);
      await t.say("[29Sep2026 22:44:51.222] [Server thread/INFO] [net.minecraft.server.network.ServerConfigurationPacketListenerImpl/]: com.mojang.authlib.GameProfile@2299b547[id=9e2b7c41-0a5d-4f36-8c19-b4e07d2a6f53,name=m1_owl,properties={}] lost connection: Incompatible client! Please use NeoForge 21.1.252");
      t.tick(120);
    }
    let prev = t.status({});
    for (let i = 0; i < 60; i++) { t.tick(10); await t.poll(ghost, prev); prev = ghost; if (i % 2 === 0) await t.say(nobody); }
    expect(t.sessions).toEqual([]);
    expect(t.events.filter((e) => e.kind === "JOIN" || e.kind === "LEAVE")).toEqual([]);
  });
  it("a player list that flaps while someone plays is one session", async () => {
    const t = setup();
    await t.say(L(`UUID of player m1_owl is ${UUID_M1}`));
    await t.say(L("m1_owl joined the game"));
    const on = t.status({ players: ["m1_owl"] });
    const off = t.status({ players: [] });
    let prev = on;
    for (let i = 0; i < 40; i++) { t.tick(10); const next = i % 3 === 0 ? off : on; await t.poll(next, prev); prev = next; if (i % 4 === 0) await t.say(L("There are 0 of a max of 20 players online: ")); }
    t.tick(10);
    await t.say(L("m1_owl left the game"));
    expect(t.sessions).toHaveLength(1);
    expect(t.events.map((e) => e.kind)).toEqual(["JOIN", "LEAVE"]);
    expect(t.events.at(-1)?.message).toBe("m1_owl left after 7 min");
  });
  it("a 30 s reconnect is one session; a join 90 s after leaving is a new one", async () => {
    const t = setup();
    await t.say(L(`UUID of player m1_owl is ${UUID_M1}`));
    await t.say(L("m1_owl joined the game"));
    t.tick(600);
    await t.say(L("m1_owl lost connection: Timed out"));
    t.tick(30);
    await t.say(L("m1_owl joined the game"));
    expect(t.sessions).toHaveLength(1);
    expect(t.sessions[0]?.leftAt).toBeNull();
    t.tick(600);
    await t.say(L("m1_owl left the game"));
    expect(t.sessions).toHaveLength(1);
    expect(t.sessions[0]?.leftAt?.toISOString()).toBe("2026-09-29T10:20:30.000Z");
    t.tick(90);
    await t.say(L("m1_owl joined the game"));
    expect(t.sessions).toHaveLength(2);
  });
  it("a join after the server went down is a new session, however soon", async () => {
    const t = setup();
    await t.say(L("m1_owl joined the game"));
    await t.poll(t.status({ state: "Sleeping", stateCode: 30, availability: "sleeping" }), t.status({}));
    t.tick(20);
    await t.say(L("m1_owl joined the game"));
    expect(t.sessions).toHaveLength(2);
  });
  it("a name seen before with a UUID keeps that UUID, even when the UUID line is not in what was read (a restart of api)", async () => {
    const t = setup();
    await t.say(L(`UUID of player m1_owl is ${UUID_M1}`));
    await t.say(L("m1_owl joined the game"));
    t.tick(60);
    await t.say(L("m1_owl left the game"));
    const store = (t as unknown as { rec: { d: { store: RecorderStore } } }).rec.d.store;
    const again = new Recorder({ store, privacy: async () => ({ chat: true, geo: true }), country: async () => null, uuidOf: () => undefined, log: () => {}, now: () => new Date(Date.parse("2026-09-29T12:00:00Z")) });
    again.onConsole({ type: "join", name: "M1_OWL", ip: null });
    await again.idle();
    expect(t.sessions.map((x) => x.mcUuid)).toEqual([UUID_M1, UUID_M1]); // never "name:m1_owl"
  });
  it("picks up sessions left open by a previous run", async () => {
    const t = setup();
    await t.say(L("m1_owl joined the game"));
    const again = new Recorder({ store: { ...(t as unknown as { rec: { d: { store: RecorderStore } } }).rec.d.store }, privacy: async () => ({ chat: true, geo: true }), country: async () => null, uuidOf: () => undefined, log: () => {} });
    await again.init();
    expect(again.openCount).toBe(1);
  });
});

describe("duration", () => {
  it("reads well", () => {
    expect(duration(20_000)).toBe("under a minute");
    expect(duration(46 * 60_000)).toBe("46 min");
    expect(duration(120 * 60_000)).toBe("2 h");
    expect(duration(135 * 60_000)).toBe("2 h 15 min");
  });
});

describe("audit entries as events", () => {
  it("picks the kind the migration picks", () => {
    expect(kindOf("link.bind", "PLAYER")).toBe("LINK");
    expect(kindOf("limbo.held", "system")).toBe("LINK");
    expect(kindOf("user.remove", "ADMIN")).toBe("REVOKE");
    expect(kindOf("player.revoke", "ADMIN")).toBe("REVOKE");
    expect(kindOf("modpack.sync-dry", "ADMIN")).toBe("SYNC");
    expect(kindOf("server.backup", "ADMIN")).toBe("BACKUP");
    expect(kindOf("installer.report", "PLAYER")).toBe("INSTALL");
    expect(kindOf("vote.open", "ADMIN")).toBe("ADMIN_ACTION");
    expect(kindOf("retention.prune", "system")).toBe("ADMIN_ACTION");
    expect(kindOf("ballot.save", "PLAYER")).toBe("PLAYER_ACTION");
    expect(kindOf("auth.login", null)).toBe("PLAYER_ACTION");
  });
  it("writes a line a person can read", () => {
    const alex = { role: "ADMIN" as const, name: "Bramble09" };
    expect(describeAction("server.restart.scheduled", alex, { minutes: 5 })).toBe("Bramble09 planned a restart in 5 minutes");
    expect(describeAction("user.remove", alex, { displayName: "Pabulum" })).toBe("Bramble09 removed Pabulum from the group");
    expect(describeAction("auth.login", { role: null, name: null }, { email: "x@y.z" }, "DENIED")).toBe("Someone tried to sign in (refused)");
    expect(describeAction("limbo.held", { role: "system", name: null }, { name: "m1_owl" })).toBe("M1_owl is waiting in the entrance room");
    expect(describeAction("server.restart", alex, { scheduled: true }, "FAILED")).toBe("The planned restart went ahead (failed)");
    expect(describeAction("server.say", alex, { text: "back in 5" })).toBe("Bramble09 said in game: back in 5");
    expect(describeAction("something.new", alex, {})).toBe("Bramble09: something.new");
    expect(describeAction("retention.prune", { role: "system", name: null }, { events: 12, ips: 3 })).toBe("Old entries cleared: 12 events, 3 addresses");
  });
});

describe("settings", () => {
  it("fills in defaults and drops only the fields that are wrong", () => {
    expect(parseSection("retention", undefined)).toEqual({ chatDays: 30, eventDays: 180, ipDays: 30, installDays: 90 });
    expect(parseSection("retention", { chatDays: 7, eventDays: "lots", ipDays: 0 })).toEqual({ chatDays: 7, eventDays: 180, ipDays: 30, installDays: 90 });
    expect(parseSection("privacy", { geo: false })).toEqual({ geo: false, chat: true, analyticsForPlayers: true });
    expect(parseSection("branding", { accent: "red", name: "  The Mine  " })).toMatchObject({ accent: "#b8652c", name: "The Mine" });
    expect(parseSection("privacy", "nonsense")).toEqual({ geo: true, chat: true, analyticsForPlayers: true });
  });
  it("refuses the paths docs/16 names and lets the ordinary ones through", () => {
    const denied = parseSection("files", undefined).denied;
    for (const p of ["world/level.dat", "world", "world/region/r.0.0.mca", "world_nether/DIM-1/data/x.dat", "world_the_end", "backups/2026.zip", "session.lock", "world/session.lock", "config/../world/level.dat", "../etc/passwd", "playerdata/abc.dat", "LocalBackups/a.zip"]) expect([p, isDenied(p, denied)]).toEqual([p, true]);
    for (const p of ["server.properties", "logs/latest.log", "logs/2026-09-28-1.log.gz", "config/bluemap/webserver.conf", "mods/jei-1.21.1.jar", "whitelist.json", "ops.json", "banned-players.json", "config/worldedit.toml"]) expect([p, isDenied(p, denied)]).toEqual([p, false]);
  });
});

describe("shared files", () => {
  it("are identical in web and api", () => {
    for (const f of readdirSync(new URL("../src/shared/", import.meta.url))) {
      expect(readFileSync(new URL(`../src/shared/${f}`, import.meta.url), "utf8")).toBe(readFileSync(new URL(`../../web/src/shared/${f}`, import.meta.url), "utf8"));
    }
  });
});
