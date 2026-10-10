import { describe, expect, it } from "vitest";
import { AmpClient, type Amp, type AmpStatus } from "../src/amp/client.js";
import { ConsoleTail, type ConsoleEvent } from "../src/amp/console.js";

// 2026-09-29, the first real join: every health check logged in to AMP afresh, every new AMP session was sent the
// last console lines again, and each time the join line in them was taken for a join. The player was "let in",
// and moved to spawn, every 30 seconds.

type Entry = { Timestamp?: string; Source?: string; Type?: string; Contents?: string };
const noLog = () => {};
const line = (n: number, text: string): Entry => ({ Timestamp: `/Date(${1790672000000 + n * 1000})/`, Source: "Server thread/INFO", Type: "Console", Contents: text });

/** An AMP that, like the real one, sends a session only what is new to it, and a new session its whole backlog. */
class FakeAmp implements Amp {
  sessions = 1;
  backlog: Entry[] = [];
  private sent = new Map<number, number>();
  async ping() {}
  async getStatus(): Promise<AmpStatus> { throw new Error("not used"); }
  async call<T>(): Promise<T> {
    const from = this.sent.get(this.sessions) ?? 0;
    this.sent.set(this.sessions, this.backlog.length);
    return { Status: { State: 20 }, ConsoleEntries: this.backlog.slice(from) } as T;
  }
  newSession() { this.sessions++; }
}

function listen(tail: ConsoleTail) {
  const joins: Array<{ name: string; replay: boolean }> = [];
  let resyncs = 0;
  tail.on((e: ConsoleEvent, info) => { if (e.type === "join") joins.push({ name: e.name, replay: info.replay }); });
  tail.onResync(() => { resyncs++; });
  return { joins, resyncs: () => resyncs };
}

describe("console lines that AMP sends again", () => {
  it("a join read once is a join once, however many sessions AMP hands the line to", async () => {
    const amp = new FakeAmp();
    const tail = new ConsoleTail(amp, noLog);
    const seen = listen(tail);
    await tail.poll(); // api has just started: nothing in the console yet
    amp.backlog.push(line(1, "UUID of player bramble09 is c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10"), line(2, "bramble09 joined the game"));
    await tail.poll();
    expect(seen.joins).toEqual([{ name: "bramble09", replay: false }]);
    for (let i = 0; i < 4; i++) {
      amp.newSession(); // what the health check used to do every 30 s
      amp.backlog.push(line(10 + i, "Overworld: 20.000 TPS (3.133 ms/tick)"));
      await tail.poll();
    }
    expect(seen.joins).toEqual([{ name: "bramble09", replay: false }]);
    expect(tail.lines.filter((l) => l === "bramble09 joined the game").length).toBe(1);
    expect(tail.lines.filter((l) => l.startsWith("Overworld")).length).toBe(4); // what was new got through
    expect(seen.resyncs()).toBe(5); // the first poll, and one for each new session
  });

  it("a line that arrived between two sessions is news, not history", async () => {
    const amp = new FakeAmp();
    const tail = new ConsoleTail(amp, noLog);
    const seen = listen(tail);
    amp.backlog.push(line(1, "Done (1.2s)! For help, type \"help\""));
    await tail.poll();
    amp.newSession();
    amp.backlog.push(line(2, "m1_owl joined the game"));
    await tail.poll();
    expect(seen.joins).toEqual([{ name: "m1_owl", replay: false }]);
  });

  it("after a restart of api the lines already in the console are history: read, shown, not acted on", async () => {
    const amp = new FakeAmp();
    amp.backlog.push(line(1, "UUID of player bramble09 is c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10"), line(2, "bramble09 joined the game"), line(3, "m1_owl joined the game"), line(4, "m1_owl left the game"));
    const tail = new ConsoleTail(amp, noLog);
    const seen = listen(tail);
    await tail.poll();
    expect(seen.joins).toEqual([{ name: "bramble09", replay: true }, { name: "m1_owl", replay: true }]);
    expect([...tail.online]).toEqual(["bramble09"]);
    expect(tail.uuidByName.get("bramble09")).toBe("c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10");
    expect(tail.lines.length).toBe(4);
    expect(seen.resyncs()).toBe(1);
    amp.backlog.push(line(5, "m1_owl joined the game"));
    await tail.poll();
    expect(seen.joins[2]).toEqual({ name: "m1_owl", replay: false });
  });
});

describe("the health check", () => {
  it("does not log in again when there is a session", async () => {
    const calls: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL) => {
      const u = String(url);
      calls.push(u.replace(/^.*\/API\//, ""));
      return new Response(JSON.stringify(u.endsWith("/Login") ? { success: true, sessionID: "s1" } : { State: 20 }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const amp = new AmpClient({ url: "http://amp.invalid", username: "webapp", password: "x", instanceId: "0a1b2c3d-test" });
      await amp.ping();
      await amp.ping();
      await amp.ping();
      expect(calls.filter((c) => c.endsWith("Core/Login")).length).toBe(1);
      expect(amp.sessions).toBe(1);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("the session id", () => {
  it("goes in an Authorization: Bearer header and never in the body (AMP 2.8 logs a deprecation for the body)", async () => {
    const seen: { path: string; auth: string | null; body: Record<string, unknown> }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/API\//, "");
      seen.push({ path, auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(JSON.stringify(path.endsWith("Core/Login") ? { success: true, sessionID: "s1" } : { State: 20 }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const amp = new AmpClient({ url: "http://amp.invalid", username: "webapp", password: "x", instanceId: "0a1b2c3d-test" });
      await amp.getStatus();
      await amp.call("FileManagerPlugin", "GetDirectoryListing", { Dir: "" });
      const [login, ...rest] = seen;
      expect(login.path.endsWith("Core/Login")).toBe(true);
      expect(login.auth).toBeNull();
      expect(login.body.username).toBe("webapp"); // login keeps its body, as AMP requires
      expect(rest.length).toBe(3);
      for (const c of rest) expect(c.auth).toBe("Bearer s1");
      for (const c of seen) expect(Object.keys(c.body).some((k) => k.toLowerCase() === "sessionid")).toBe(false);
      expect(rest[2].body).toEqual({ Dir: "" });
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("the wait room", () => {
  it("takes the two lines of one join for one join, and old lines for none", async () => {
    const { Limbo } = await import("../src/players/limbo.js");
    const amp = new FakeAmp();
    const tail = new ConsoleTail(amp, noLog);
    const env = { LIMBO_POS: "deepslate:limbo 0.5 65 0.5", SPAWN_POS: "", PORTAL_URL: "https://deepslate.dsw.test" } as never;
    const limbo = new Limbo(env, amp, tail, noLog);
    const joined: string[] = [];
    limbo.onJoin = async (name: string) => { joined.push(name); };
    await limbo.onEvent({ type: "join", name: "bramble09", ip: "10.0.0.5" });
    await limbo.onEvent({ type: "join", name: "bramble09", ip: null });
    expect(joined).toEqual(["bramble09"]);
    await limbo.onEvent({ type: "join", name: "m1_owl", ip: null }, { replay: true });
    expect(joined).toEqual(["bramble09"]);
    await limbo.onEvent({ type: "leave", name: "bramble09", reason: null });
    await limbo.onEvent({ type: "join", name: "bramble09", ip: null }); // back at once: a join again
    expect(joined).toEqual(["bramble09", "bramble09"]);
  });
});

describe("a session AMP has forgotten", () => {
  it("is known by what AMP answers, with HTTP 200", async () => {
    const { sessionGone } = await import("../src/amp/client.js");
    expect(sessionGone({ Status: false, Reason: "You do not have permission to use this method (GSMyAdmin.WebServer.Start) at this time. This method requires the Session.Exists permission." })).toBe(true);
    expect(sessionGone({ Status: false, Reason: "You do not have permission to use this method at this time. This method requires the Core.AppManagement.StartInstance permission." })).toBe(false);
    expect(sessionGone({ State: 20 })).toBe(false);
    expect(sessionGone(null)).toBe(false);
  });
  it("makes the client log in again and ask once more", async () => {
    const calls: string[] = [];
    const real = globalThis.fetch;
    let logins = 0;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url).replace(/^.*\/API\//, "");
      calls.push(u);
      const sid = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "");
      let answer: unknown;
      if (u.endsWith("Core/Login")) answer = { success: true, sessionID: `s${++logins}` };
      else if (sid === "s1") answer = { Status: false, Reason: "This method requires the Session.Exists permission." };
      else answer = { State: 20 };
      return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const amp = new AmpClient({ url: "http://amp.invalid", username: "webapp", password: "x", instanceId: "0a1b2c3d-test" });
      expect(await amp.call("Core", "GetStatus")).toEqual({ State: 20 });
      expect(calls.filter((c) => c.endsWith("Core/Login")).length).toBe(2);
      expect(amp.sessions).toBe(2);
      await amp.ping(); // the health check, on the session there is now
      expect(amp.sessions).toBe(2);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("a permission the portal's AMP user does not have", () => {
  it("is remembered: a refusal never costs a new login, however often it is asked (the test api's session drops, 3.6.1)", async () => {
    const real = globalThis.fetch;
    let logins = 0, asked = 0;
    globalThis.fetch = (async (url: string | URL) => {
      const u = String(url).replace(/^.*\/API\//, "");
      let answer: unknown = {};
      if (u.endsWith("Core/Login")) answer = { success: true, sessionID: `s${++logins}` };
      else if (u.endsWith("Core/CurrentSessionHasPermission")) { asked++; answer = false; }
      return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const amp = new AmpClient({ url: "http://amp.invalid", username: "webapp", password: "x", instanceId: "0a1b2c3d-test" });
      const now = Date.now;
      let t = now();
      Date.now = () => t;
      try {
        // the test site's Admin → Overview, every 30 s for ten minutes: the backup permissions, refused
        for (let i = 0; i < 20; i++) {
          expect(await amp.hasPermission("LocalFileBackupPlugin.Backups.ViewBackups")).toBe(false);
          expect(await amp.hasPermission("LocalFileBackupPlugin.Backups.CreateBackup")).toBe(false);
          t += 30_000;
        }
      } finally {
        Date.now = now;
      }
      expect(logins).toBe(1); // the one session, all along
      expect(amp.sessions).toBe(1);
      expect(asked).toBe(2); // each refusal asked once on that session
      const { session } = await amp.callTagged("Core", "GetStatus");
      expect(session).toBe(1);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("asks again on a new session: a permission granted in AMP is seen after the api's next login", async () => {
    const real = globalThis.fetch;
    let logins = 0;
    const granted = new Set<string>(); // sessions that were opened after the grant
    let grantedNow = false, expire = false;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url).replace(/^.*\/API\//, "");
      const sid = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "");
      if (expire && !u.endsWith("Core/Login")) { expire = false; return new Response("", { status: 401 }); }
      let answer: unknown = {};
      if (u.endsWith("Core/Login")) {
        const id = `s${++logins}`;
        if (grantedNow) granted.add(id);
        answer = { success: true, sessionID: id };
      } else if (u.endsWith("Core/CurrentSessionHasPermission")) answer = granted.has(String(sid));
      return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const amp = new AmpClient({ url: "http://amp.invalid", username: "webapp", password: "x", instanceId: "0a1b2c3d-test" });
      expect(await amp.hasPermission("Settings.MinecraftModule.Limits.SleepMode")).toBe(false); // not granted
      expect(logins).toBe(1);
      grantedNow = true; // granted in AMP while the portal is logged in
      expect(await amp.hasPermission("Settings.MinecraftModule.Limits.SleepMode")).toBe(false); // the same session: remembered, no login
      expect(logins).toBe(1);
      expire = true; // the session runs out (or the api restarts): the next call logs in
      await amp.call("Core", "GetStatus");
      expect(logins).toBe(2);
      expect(await amp.hasPermission("Settings.MinecraftModule.Limits.SleepMode")).toBe(true); // asked again on the new session
      expect(await amp.hasPermission("Settings.MinecraftModule.Limits.SleepMode")).toBe(true); // a yes costs nothing
      expect(logins).toBe(2);
    } finally {
      globalThis.fetch = real;
    }
  });
});
