import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { GameWatch, MISSES_TO_DOWN, gameAddress, nextAnswering, pingGame, readStatus, statusRequest, type GamePing } from "../src/status/game-ping.js";
import { serverState, stateHint, stateLine, wakeDecision, JOINABLE, TONE } from "../src/shared/server-state.js";

// Alex, 2026-11-01: AMP can say Running while nobody can join; the game is asked as a player's game asks it.

const varint = (n: number) => {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
};
const statusPacket = (json: string) => {
  const s = Buffer.from(json, "utf8");
  const body = Buffer.concat([varint(0), varint(s.length), s]);
  return Buffer.concat([varint(body.length), body]);
};
const ANSWER = statusPacket(JSON.stringify({ version: { name: "1.21.1", protocol: 767 }, players: { max: 20, online: 2 }, description: "Deepslate" }));

describe("the status request", () => {
  it("is a handshake for status with the address players type, then a status request", () => {
    const b = statusRequest("mc.dsw.test", 25565);
    const name = Buffer.from("mc.dsw.test");
    // [len][id 0][767 = ff 05][name len][name][63 dd][next state 1] [len 1][id 0]
    expect([...b.subarray(0, 5)]).toEqual([1 + 2 + 1 + name.length + 2 + 1, 0, 0xff, 0x05, name.length]);
    expect(b.subarray(5, 5 + name.length).toString()).toBe("mc.dsw.test");
    expect([...b.subarray(5 + name.length)]).toEqual([0x63, 0xdd, 1, 1, 0]);
  });
  it("reads the answer once all of it is in, and says no to anything else", () => {
    expect(readStatus(ANSWER)).toEqual({ online: 2 });
    expect(readStatus(ANSWER.subarray(0, 10))).toBeNull();
    expect(() => readStatus(Buffer.from([2, 0x1b, 0]))).toThrow(); // a disconnect packet is not a status answer
  });
  it("takes the address as SERVER_ADDRESS has it", () => {
    expect(gameAddress("mc.dsw.test")).toEqual({ host: "mc.dsw.test", port: 25565 });
    expect(gameAddress("lab.dsw.test:25566")).toEqual({ host: "lab.dsw.test", port: 25566 });
    for (const bad of [undefined, "", "mc.dsw.test:0", "mc.dsw.test:99999", "http://mc.dsw.test"]) expect(gameAddress(bad)).toBeNull();
  });
});

describe("pingGame against a socket", () => {
  let server: Server | null = null;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));
  const listen = (onData: (sock: import("node:net").Socket) => void) => new Promise<number>((resolve) => {
    server = createServer((sock) => sock.once("data", () => onData(sock)));
    server.listen(0, "127.0.0.1", () => resolve((server!.address() as { port: number }).port));
  });

  it("answers ok with the player count, even when the answer comes in pieces", async () => {
    const port = await listen((sock) => {
      sock.write(ANSWER.subarray(0, 7));
      setTimeout(() => sock.write(ANSWER.subarray(7)), 20);
    });
    const r = await pingGame("127.0.0.1", port, 2000);
    expect(r).toMatchObject({ ok: true, online: 2 });
  });
  it("is a miss when the game takes the connection and says nothing", async () => {
    const port = await listen(() => {});
    expect(await pingGame("127.0.0.1", port, 200)).toEqual({ ok: false, error: "no answer" });
  });
  it("is a miss when the connection is closed on it, or refused", async () => {
    const port = await listen((sock) => sock.end());
    expect(await pingGame("127.0.0.1", port, 2000)).toEqual({ ok: false, error: "the connection was closed" });
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
    expect(await pingGame("127.0.0.1", port, 2000)).toEqual({ ok: false, error: "ECONNREFUSED" });
  });
});

describe("answering", () => {
  const miss: GamePing = { ok: false, error: "no answer" };
  const hit: GamePing = { ok: true, ms: 5, online: 0 };
  it("goes to no only after three misses in a row, and back to yes on one answer", () => {
    let s = { misses: 0, answering: true as boolean | null };
    for (let i = 1; i < MISSES_TO_DOWN; i++) {
      s = nextAnswering(s, miss);
      expect(s.answering).toBe(true);
    }
    s = nextAnswering(s, miss);
    expect(s).toEqual({ misses: 3, answering: false });
    expect(nextAnswering(s, hit)).toEqual({ misses: 0, answering: true });
  });
  it("is not looked at while AMP does not say Running", () => {
    expect(nextAnswering({ misses: 5, answering: false }, null)).toEqual({ misses: 0, answering: null });
  });
});

describe("GameWatch", () => {
  it("tells once when the game stops answering, and once when it answers again after a restart", async () => {
    let running = true;
    const answers: GamePing[] = [];
    const told: Array<[boolean, string | null]> = [];
    const asked: string[] = [];
    const w = new GameWatch({ host: "mc.dsw.test", port: 25565 }, () => running, () => {}, async (h, p) => {
      asked.push(`${h}:${p}`);
      return answers.shift() ?? { ok: false, error: "no answer" };
    });
    w.onChange((a, e) => told.push([a, e]));
    answers.push({ ok: true, ms: 3, online: 1 });
    await w.round();
    expect([w.answering, told]).toEqual([true, []]);
    for (let i = 0; i < 5; i++) await w.round(); // five misses: told once
    expect(w.answering).toBe(false);
    expect(told).toEqual([[false, "no answer"]]);
    running = false; // Alex restarts it: not looked at, nothing told
    await w.round();
    expect([w.answering, told.length]).toEqual([null, 1]);
    running = true;
    answers.push({ ok: true, ms: 3, online: 0 });
    await w.round();
    expect(told).toEqual([[false, "no answer"], [true, null]]);
    expect(asked.every((a) => a === "mc.dsw.test:25565")).toBe(true);
    expect(asked).toHaveLength(7);
  });
});

describe("Not answering, in the shared words", () => {
  const up = { reachable: true, waking: false, crashed: false };
  it("is the state when AMP says Running and the game does not answer", () => {
    expect(serverState({ ...up, stateCode: 20, answering: false })).toBe("unresponsive");
    expect(serverState({ ...up, stateCode: 20, answering: null })).toBe("online");
    expect(serverState({ ...up, stateCode: 20, answering: true })).toBe("online");
    expect(serverState({ ...up, stateCode: 50, answering: false })).toBe("asleep"); // only Running is asked about
    expect(serverState({ ...up, stateCode: 20, answering: false, reachable: false })).toBe("unreachable");
  });
  it("is bad, not joinable, and Play does not wake it", () => {
    expect(TONE.unresponsive).toBe("bad");
    expect(JOINABLE.has("unresponsive")).toBe(false);
    expect(wakeDecision({ member: true, openFor: true, state: "unresponsive" })).toBe("crashed");
    expect(stateLine("unresponsive")).toBe("Not answering, nobody can join right now");
    expect(stateHint("unresponsive", false)).toContain("nobody can join");
    expect(stateHint("unresponsive", true)).toContain("AMP says the server is running");
  });
});
