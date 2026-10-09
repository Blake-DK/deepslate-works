import { beforeEach, describe, expect, it, vi } from "vitest";
import { AmpClient } from "../src/amp/client.js";
import { ConsoleTail } from "../src/amp/console.js";
import { memoryHeldStore } from "../src/players/held-store.js";
import { Limbo, type Back } from "../src/players/limbo.js";
import type { BlockReason } from "../src/shared/join-gate.js";

// docs/31 B-02, B-03, B-04, B-41 (the planner's PR C): the entrance room keeps who it holds, and where they stood,
// in the table HeldPlayer; it acts on the server's live `list` answer after a restart, never on old lines; nobody is
// held by name alone; and two callers that meet a dead AMP session log in once between them.

const UUID_A = "c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10";
const UUID_B = "9e2b7c41-0a5d-4f36-8c19-b4e07d2a6f53";

const state = vi.hoisted(() => ({
  ran: [] as Array<{ name: string; input: Record<string, unknown> }>,
  audits: [] as Array<{ action: string; params: Record<string, unknown>; result?: string }>,
  users: [] as Array<{ id: string; mcUuid: string | null; mcUsername: string | null; verifiedAt: Date | null; guildMember: boolean; role: "PLAYER" | "ADMIN"; earlyAccess: boolean }>,
  codes: 0,
  sessions: [] as Array<{ id: string; mcUuid: string; joinedAt: Date }>, // the open ones
  fail: new Set<string>(), // actions the server does not take
  nameTaken: false, // another account still carries the name: the unique column refuses it
  cleared: 0,
}));

vi.mock("../src/actions/run.js", () => ({
  runAction: async (_amp: unknown, _ctx: unknown, name: string, input: Record<string, unknown>) => {
    state.ran.push({ name, input });
    return state.fail.has(name) ? { ok: false, commands: 0, detail: "timeout" } : { ok: true, commands: 1 };
  },
}));
vi.mock("../src/audit.js", () => ({ audit: async (a: { action: string; params: Record<string, unknown>; result?: string }) => void state.audits.push(a) }));
vi.mock("../src/settings.js", () => ({ getSection: async (k: string) => (k === "joining" ? { requirePlay: true, windowMin: 30 } : { name: "Deepslate Works", tagline: "" }) }));
vi.mock("../src/db.js", () => {
  type Where = { mcUuid?: string; mcUsername?: string; id?: string };
  const find = (where: Where) => state.users.find((u) => (where.mcUuid ? u.mcUuid === where.mcUuid : where.mcUsername ? u.mcUsername === where.mcUsername : u.id === where.id)) ?? null;
  return {
    db: {
      user: {
        findFirst: async ({ where }: { where: Where }) => find(where),
        findUnique: async ({ where }: { where: Where }) => find(where),
        update: async () => {
          if (state.nameTaken) throw new Error("Unique constraint failed on the fields: (`mcUsername`)");
          return {};
        },
        updateMany: async () => {
          state.nameTaken = false;
          state.cleared++;
          return { count: 1 };
        },
      },
      session: {
        findFirst: async ({ where }: { where: { joinedAt: { lt: Date }; mcUuid: { in: string[] } } }) => state.sessions.find((s) => where.mcUuid.in.includes(s.mcUuid) && s.joinedAt < where.joinedAt.lt) ?? null,
      },
      linkCode: { updateMany: async () => ({ count: 0 }), findFirst: async () => null, findUnique: async () => null, create: async () => ({ code: `CODE${++state.codes}` }) },
    },
  };
});

const env = { LIMBO_POS: "deepslate:limbo 0.5 65 0.5", SPAWN_POS: "107.5 126 87.5", PORTAL_URL: "https://deepslate.dsw.test" } as never;
const BASE: Back = { dimension: "minecraft:overworld", x: 812.5, y: 71, z: -344.5 };
const ROOM: Back = { dimension: "deepslate:limbo", x: 0.5, y: 65, z: 0.5 };

/** A room whose door and "where are they" are the test's to set. */
class Room extends Limbo {
  blocked: BlockReason | null = "no report";
  standing: Back | null = BASE;
  protected override async atTheDoor() { return this.blocked; }
  protected override async where() { return this.standing; }
  protected override async prompt() {}
}

function fakeTail() {
  return { online: new Set<string>(), uuidByName: new Map<string, string>(), state: 20, on() {}, onResync() {} };
}

function setup() {
  const tail = fakeTail();
  const store = memoryHeldStore();
  const room = new Room(env, {} as never, tail as never, () => undefined, store);
  const join = async (name: string, uuid: string | null) => {
    tail.online.add(name);
    if (uuid) tail.uuidByName.set(name, uuid);
    await room.onJoin(name);
  };
  const leave = async (name: string) => {
    tail.online.delete(name);
    await room.onEvent({ type: "leave", name, reason: null });
  };
  return { tail, store, room, join, leave };
}
const member = (id: string, uuid: string, name: string) => ({ id, mcUuid: uuid, mcUsername: name, verifiedAt: new Date("2026-09-29T18:16:00Z"), guildMember: true, role: "PLAYER" as const, earlyAccess: false });
const ran = (name: string) => state.ran.filter((r) => r.name === name);
const tick = (room: Limbo) => (room as unknown as { tick(): Promise<void> }).tick();

beforeEach(() => {
  state.ran.length = 0;
  state.audits.length = 0;
  state.users = [member("u1", UUID_A, "samoyedx")];
  state.codes = 0;
  state.sessions = [];
  state.fail.clear();
  state.nameTaken = false;
  state.cleared = 0;
});

describe("a member held twice goes back to where they first stood (B-02)", () => {
  it("held at their base, leaves, comes back still blocked, then the door opens: back to the base, not into the room", async () => {
    const t = setup();
    await t.join("samoyedx", UUID_A);
    expect(ran("limbo.holdPlay")).toHaveLength(1);
    expect(t.store.rows.get(UUID_A)).toMatchObject({ reason: "no report", back: BASE });

    await t.leave("samoyedx");
    expect(t.room.held.has("samoyedx")).toBe(false);
    expect(t.store.rows.get(UUID_A)?.back).toEqual(BASE); // a leave does not forget

    t.room.standing = ROOM; // they logged out in the room, so that is where the server says they are
    await t.join("samoyedx", UUID_A);
    expect(t.room.held.get("samoyedx")?.back).toEqual(BASE);
    expect(t.store.rows.get(UUID_A)?.back).toEqual(BASE); // the room is never stored as a place to go back to

    t.room.blocked = null; // they pressed Play
    await tick(t.room);
    expect(ran("limbo.releaseBack").at(-1)?.input).toEqual({ name: "samoyedx", back: BASE });
    expect(t.store.rows.has(UUID_A)).toBe(false);
    expect(t.room.held.has("samoyedx")).toBe(false);
  });

  it("held, leaves, presses Play, comes back: back to the base, not to spawn", async () => {
    const t = setup();
    await t.join("samoyedx", UUID_A);
    await t.leave("samoyedx");
    t.room.blocked = null;
    t.room.standing = ROOM;
    await t.join("samoyedx", UUID_A);
    expect(ran("link.release")).toHaveLength(0);
    expect(ran("limbo.releaseBack").at(-1)?.input).toEqual({ name: "samoyedx", back: BASE });
    expect(t.store.rows.has(UUID_A)).toBe(false);
  });

  it("nothing kept and the server says they stand in the room: spawn, never the room", async () => {
    const t = setup();
    t.room.standing = ROOM;
    await t.join("samoyedx", UUID_A);
    expect(t.store.rows.get(UUID_A)?.back).toBeNull();
    t.room.blocked = null;
    await tick(t.room);
    expect(ran("limbo.releaseBack").at(-1)?.input).toEqual({ name: "samoyedx", back: null }); // the action sends a null back to SPAWN_POS
  });

  it("a member who is let straight in is not touched and nothing is kept", async () => {
    const t = setup();
    t.room.blocked = null;
    await t.join("samoyedx", UUID_A);
    expect(ran("link.release")).toHaveLength(1);
    expect(ran("limbo.releaseBack")).toHaveLength(0);
    expect(t.store.rows.size).toBe(0);
  });
});

describe("after a restart of api the room acts on the live list answer only (B-03, B-04)", () => {
  it("old lines alone move nobody; the live `list` answer does the work", async () => {
    const t = setup();
    state.users = [];
    t.tail.online.add("stranger");
    t.tail.uuidByName.set("stranger", UUID_B);
    let onResync = () => {};
    (t.tail as { onResync: (h: () => void) => void }).onResync = (h) => { onResync = h; };
    t.room.start();
    t.room.stop();
    onResync(); // old lines have been read
    await t.room.onEvent({ type: "list", online: 1, max: 20, names: ["stranger"] }, { replay: true });
    expect(ran("limbo.hold")).toHaveLength(0);
    await t.room.onEvent({ type: "list", online: 1, max: 20, names: ["stranger"] }, { replay: false });
    expect(ran("limbo.hold")).toHaveLength(1);
    await t.room.onEvent({ type: "list", online: 1, max: 20, names: ["stranger"] }, { replay: false }); // once per resync
    expect(ran("limbo.hold")).toHaveLength(1);
  });

  it("a playing member with no UUID in memory is found by name and left exactly where they are", async () => {
    const t = setup();
    state.sessions = [{ id: "s1", mcUuid: UUID_A, joinedAt: new Date(Date.now() - 3_600_000) }]; // the run before saw them join
    await t.room.resync(["samoyedx"]);
    expect(state.ran).toEqual([]);
    expect(t.room.held.size).toBe(0);
    expect(t.tail.uuidByName.get("samoyedx")).toBe(UUID_A); // and known again, so a later revoke or release finds them
  });

  it("a member whose join was only in the old lines meets the door on the live list answer (R-05)", async () => {
    const t = setup();
    t.tail.online.add("samoyedx");
    t.tail.uuidByName.set("samoyedx", UUID_A);
    await t.room.onEvent({ type: "join", name: "samoyedx", ip: null }, { replay: true }); // read as history: nothing done
    expect(state.ran).toEqual([]);
    await t.room.resync(["samoyedx"]); // no session of theirs is open: nobody saw them come in
    expect(ran("limbo.holdPlay")).toHaveLength(1);
    expect(t.room.held.get("samoyedx")).toMatchObject({ kind: "play", userId: "u1", back: BASE });
  });

  it("and is let in when the door has nothing to ask; a linked member left in the room without their tag gets out", async () => {
    const t = setup();
    t.room.blocked = null;
    t.tail.online.add("samoyedx");
    t.tail.uuidByName.set("samoyedx", UUID_A);
    await t.room.resync(["samoyedx"]);
    expect(state.ran.map((r) => r.name)).toEqual(["link.release"]); // changes nothing for someone who has their tag
    expect(t.room.held.size).toBe(0);
  });

  it("a member this run of api saw join is left alone by a later resync (a new AMP session)", async () => {
    const t = setup();
    t.room.blocked = null;
    t.tail.online.add("samoyedx");
    t.tail.uuidByName.set("samoyedx", UUID_A);
    await t.room.onEvent({ type: "join", name: "samoyedx", ip: null });
    state.ran.length = 0;
    t.room.blocked = "no report"; // their run of Play has aged since: that is for their next join
    await t.room.resync(["samoyedx"]);
    expect(state.ran).toEqual([]);
    expect(t.room.held.size).toBe(0);
  });

  it("a name with no UUID in memory and no member of that name is not held by name", async () => {
    const t = setup();
    await t.room.resync(["whoisthis"]);
    expect(state.ran).toEqual([]);
    expect(t.room.held.size).toBe(0);
  });

  it("with the UUID in memory and no account, they are held with a real code as before", async () => {
    const t = setup();
    t.tail.online.add("stranger");
    t.tail.uuidByName.set("stranger", UUID_B);
    await t.room.resync(["stranger"]);
    expect(ran("limbo.hold")).toHaveLength(1);
    expect(t.room.held.get("stranger")).toMatchObject({ kind: "link", uuid: UUID_B });
    expect(t.store.rows.get(UUID_B)).toMatchObject({ reason: "unknown uuid", back: null });
  });

  it("a member who was being held when api restarted is held again, and Play still lets them back to their base", async () => {
    const before = setup();
    await before.join("samoyedx", UUID_A); // held for Play first, standing at the base
    // api restarts: a new room, nothing in memory, the same table
    const tail = fakeTail();
    tail.online.add("samoyedx");
    const room = new Room(env, {} as never, tail as never, () => undefined, before.store);
    state.ran.length = 0;
    await room.resync(["samoyedx"]);
    expect(room.held.get("samoyedx")).toMatchObject({ kind: "play", uuid: UUID_A, userId: "u1", back: BASE });
    expect(ran("limbo.holdPlay")).toHaveLength(0); // they are in the room already: not moved again
    room.blocked = null;
    await tick(room);
    expect(ran("limbo.releaseBack").at(-1)?.input).toEqual({ name: "samoyedx", back: BASE });
    expect(before.store.rows.size).toBe(0);
  });

  it("a join whose UUID line was never read holds nobody by name", async () => {
    const t = setup();
    await t.join("stranger", null);
    expect(ran("limbo.hold")).toHaveLength(0);
    expect(t.room.held.size).toBe(0);
    expect(state.audits.at(-1)).toMatchObject({ action: "limbo.held", result: "FAILED" });
  }, 10_000);
});

describe("a release the server did not take (R-02, R-33)", () => {
  it("keeps them in the room's list, and the next round lets them out", async () => {
    const t = setup();
    await t.join("samoyedx", UUID_A);
    t.room.blocked = null; // they pressed Play
    state.fail.add("limbo.releaseBack"); // AMP times out
    await tick(t.room);
    expect(ran("limbo.releaseBack")).toHaveLength(1); // once in the round, not for ever
    expect(t.room.held.has("samoyedx")).toBe(true);
    expect(t.store.rows.has(UUID_A)).toBe(true);
    expect(state.audits.at(-1)).toMatchObject({ action: "join.ready", result: "FAILED" });
    state.fail.clear();
    await tick(t.room);
    expect(ran("limbo.releaseBack").at(-1)?.input).toEqual({ name: "samoyedx", back: BASE });
    expect(t.room.held.has("samoyedx")).toBe(false);
    expect(t.store.rows.has(UUID_A)).toBe(false);
  });

  it("after linking: they stay in the list as a member, and the next round lets them out", async () => {
    const t = setup();
    state.users = [];
    await t.join("samoyedx", UUID_A); // unknown: held to link
    expect(t.room.held.get("samoyedx")?.kind).toBe("link");
    state.users = [member("u1", UUID_A, "samoyedx")]; // they link on the site
    t.room.blocked = null;
    state.fail.add("link.release");
    expect(await t.room.release(UUID_A)).toEqual({ released: false, name: "samoyedx" });
    expect(t.room.held.get("samoyedx")).toMatchObject({ kind: "play", userId: "u1" });
    state.fail.clear();
    await tick(t.room);
    expect(ran("limbo.releaseBack")).toHaveLength(1);
    expect(t.room.held.has("samoyedx")).toBe(false);
  });

  it("two rounds at once: the second does nothing", async () => {
    const t = setup();
    await t.join("samoyedx", UUID_A);
    t.room.blocked = null;
    await Promise.all([tick(t.room), tick(t.room)]);
    expect(ran("limbo.keep")).toHaveLength(1);
    expect(ran("limbo.releaseBack")).toHaveLength(1);
  });
});

describe("the link's release asks who they are (R-41)", () => {
  it("lets nobody in for a UUID no member has linked", async () => {
    const t = setup();
    state.users = [];
    await t.join("stranger", UUID_B);
    expect(await t.room.release(UUID_B)).toEqual({ released: false });
    expect(ran("link.release")).toHaveLength(0);
    expect(t.room.held.get("stranger")?.kind).toBe("link");
  });

  it("nor for a member who has left the Discord server", async () => {
    const t = setup();
    state.users = [{ ...member("u1", UUID_A, "samoyedx"), guildMember: false }];
    await t.join("samoyedx", UUID_A);
    expect(await t.room.release(UUID_A)).toEqual({ released: false });
    expect(ran("link.release")).toHaveLength(0);
  });
});

describe("a name another account still carries (R-30)", () => {
  it("is taken off that account, and the join goes on", async () => {
    const t = setup();
    t.room.blocked = null;
    state.nameTaken = true;
    await t.join("newname", UUID_A); // u1 was samoyedx
    expect(state.cleared).toBe(1);
    expect(ran("link.release")).toHaveLength(1);
  });
});

describe("Release on the Control Room card", () => {
  it("lets a held member in whatever the door says, back to where they stood, with the admin on the audit row", async () => {
    const t = setup();
    await t.join("samoyedx", UUID_A);
    expect(t.room.heldList()).toEqual([expect.objectContaining({ name: "samoyedx", kind: "play", reason: "no report", member: true, back: true })]);
    expect(await t.room.adminRelease("samoyedx", "admin1")).toEqual({ ok: true });
    expect(ran("limbo.releaseBack").at(-1)?.input).toEqual({ name: "samoyedx", back: BASE });
    expect(t.store.rows.size).toBe(0);
    expect(state.audits.at(-1)).toMatchObject({ action: "limbo.adminRelease", userId: "admin1", result: "OK" });
  });

  it("never lets in someone who has not linked, and says so", async () => {
    const t = setup();
    state.users = [];
    await t.join("stranger", UUID_B);
    expect(await t.room.adminRelease("stranger", "admin1")).toEqual({ ok: false, code: "not_linked" });
    expect(ran("limbo.releaseBack")).toHaveLength(0);
    expect(t.room.held.has("stranger")).toBe(true);
    expect(await t.room.adminRelease("nobody", "admin1")).toEqual({ ok: false, code: "not_held" });
  });
});

describe("two callers meet a dead AMP session at once (B-41)", () => {
  const withAmp = async (fn: (amp: AmpClient, seen: { logins: number }) => Promise<void>) => {
    const real = globalThis.fetch;
    const seen = { logins: 0 };
    const dead = new Set<string>();
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url).replace(/^.*\/API\//, "");
      const sid = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "");
      await new Promise((r) => setTimeout(r, 5)); // every answer takes a moment, so the two callers overlap
      let answer: unknown;
      if (u.endsWith("Core/Login")) answer = { success: true, sessionID: `s${++seen.logins}` };
      else if (u.endsWith("Test/Expire")) { dead.add(String(sid)); answer = {}; }
      else if (sid && dead.has(sid)) answer = { Status: false, Reason: "This method requires the Session.Exists permission." };
      else answer = u.endsWith("Core/GetUpdates") ? { Status: { State: 20 }, ConsoleEntries: [] } : { State: 20, sid };
      return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      await fn(new AmpClient({ url: "http://amp.invalid", username: "webapp", password: "x", instanceId: "0a1b2c3d-test" }), seen);
    } finally {
      globalThis.fetch = real;
    }
  };

  it("they log in once between them, and both get their answers", async () => {
    await withAmp(async (amp, seen) => {
      await amp.call("Core", "GetStatus");
      expect(seen.logins).toBe(1);
      await amp.call("Test", "Expire"); // AMP forgets s1
      const answers = await Promise.all([amp.call<{ sid: string }>("Core", "GetStatus"), amp.call<{ sid: string }>("Core", "GetStatus"), amp.call<{ sid: string }>("Core", "GetStatus")]);
      expect(seen.logins).toBe(2);
      expect(amp.sessions).toBe(2);
      expect(answers.map((a) => a.sid)).toEqual(["s2", "s2", "s2"]);
    });
  });

  it("the first login is shared too", async () => {
    await withAmp(async (amp, seen) => {
      await Promise.all([amp.call("Core", "GetStatus"), amp.call("Core", "GetStatus")]);
      expect(seen.logins).toBe(1);
    });
  });

  it("the tail is told which login answered it, so a new session's old lines are never taken for news", async () => {
    await withAmp(async (amp) => {
      const first = await amp.callTagged("Core", "GetUpdates");
      expect(first.session).toBe(1);
      await amp.call("Test", "Expire");
      const [a, b] = await Promise.all([amp.callTagged("Core", "GetUpdates"), amp.callTagged("Core", "GetStatus")]);
      expect([a.session, b.session]).toEqual([2, 2]);
      const tail = new ConsoleTail(amp, () => undefined);
      let resyncs = 0;
      tail.onResync(() => { resyncs++; });
      await tail.poll(); // the first poll of a tail is always a backlog
      await tail.poll();
      expect(resyncs).toBe(1);
    });
  });
});

describe("the door lets a player in once a visit (3.6.1, item 11)", () => {
  function logged() {
    const tail = fakeTail();
    const logs: string[] = [];
    const room = new Room(env, {} as never, tail as never, (_o, m) => void logs.push(m), memoryHeldStore());
    room.blocked = null;
    tail.online.add("samoyedx");
    tail.uuidByName.set("samoyedx", UUID_A);
    return { tail, room, logs };
  }

  it("a resync after a new AMP session leaves a member already in alone and says nothing of a release", async () => {
    const t = logged();
    await t.room.onEvent({ type: "join", name: "samoyedx", ip: null });
    expect(ran("link.release")).toHaveLength(1);
    t.logs.length = 0;
    for (let i = 0; i < 3; i++) await t.room.resync(["samoyedx"]); // three new sessions
    expect(ran("link.release")).toHaveLength(1);
    expect(t.logs.filter((m) => m.startsWith("resync"))).toEqual([]);
  });

  it("their join line read again later, with no leave since, is not a new visit", async () => {
    const t = logged();
    const now = vi.spyOn(Date, "now");
    let clock = Date.parse("2026-10-09T16:00:00Z");
    now.mockImplementation(() => clock);
    try {
      await t.room.onEvent({ type: "join", name: "samoyedx", ip: null });
      expect(ran("link.release")).toHaveLength(1);
      clock += 90_000; // a new AMP session sends its last lines again; this one was not among those seen
      await t.room.onEvent({ type: "join", name: "samoyedx", ip: null });
      expect(ran("link.release")).toHaveLength(1);
      expect(t.logs).toContain("join: already in, with no leave since: not a new visit");
      // a real new visit: a leave, then a join
      await t.room.onEvent({ type: "leave", name: "samoyedx", reason: null });
      clock += 90_000;
      await t.room.onEvent({ type: "join", name: "samoyedx", ip: null });
      expect(ran("link.release")).toHaveLength(2);
    } finally {
      now.mockRestore();
    }
  });

  it("a server that stops ends every visit: the first join after the start meets the door (rehearsal, 2026-10-09)", async () => {
    for (const end of ["stopping", "started"] as const) {
      state.ran.length = 0;
      const t = logged();
      const now = vi.spyOn(Date, "now");
      let clock = Date.parse("2026-10-09T19:34:38Z");
      now.mockImplementation(() => clock);
      try {
        await t.room.onEvent({ type: "join", name: "samoyedx", ip: null });
        expect(ran("link.release")).toHaveLength(1);
        clock += 60_000; // the server stops with them on: no "left the game" line, the session closed by the stop
        await t.room.onEvent(end === "stopping" ? { type: "stopping" } : { type: "started", seconds: 20 });
        clock += 29_000;
        await t.room.onEvent({ type: "join", name: "samoyedx", ip: null }); // back after the start
        expect(ran("link.release"), end).toHaveLength(2);
        expect(t.logs).not.toContain("join: already in, with no leave since: not a new visit");
      } finally {
        now.mockRestore();
      }
    }
  });

  it("and a server that went down without saying so (AMP's state not running) ends them too", async () => {
    const t = logged();
    const now = vi.spyOn(Date, "now");
    let clock = Date.parse("2026-10-09T19:34:38Z");
    now.mockImplementation(() => clock);
    try {
      await t.room.onEvent({ type: "join", name: "samoyedx", ip: null });
      (t.tail as { state: number }).state = 0; // crashed or killed
      await tick(t.room);
      (t.tail as { state: number }).state = 20;
      clock += 90_000;
      await t.room.onEvent({ type: "join", name: "samoyedx", ip: null });
      expect(ran("link.release")).toHaveLength(2);
    } finally {
      now.mockRestore();
    }
  });

  it("a live `list` without them is their leave, when its line was never read", async () => {
    const t = logged();
    const now = vi.spyOn(Date, "now");
    let clock = Date.parse("2026-10-09T16:00:00Z");
    now.mockImplementation(() => clock);
    try {
      await t.room.onEvent({ type: "join", name: "samoyedx", ip: null });
      await t.room.onEvent({ type: "list", online: 0, max: 20, names: [] }, { replay: true }); // old lines say nothing
      clock += 90_000;
      await t.room.onEvent({ type: "join", name: "samoyedx", ip: null });
      expect(ran("link.release")).toHaveLength(1);
      await t.room.onEvent({ type: "list", online: 0, max: 20, names: [] }, { replay: false }); // the server's live answer
      clock += 90_000;
      await t.room.onEvent({ type: "join", name: "samoyedx", ip: null });
      expect(ran("link.release")).toHaveLength(2);
    } finally {
      now.mockRestore();
    }
  });
});
