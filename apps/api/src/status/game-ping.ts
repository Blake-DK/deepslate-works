import { connect } from "node:net";

// Alex, 2026-11-01: "it can be down but the status doesnt change in discord". AMP can say Running while nobody can
// join: the game stopped answering, mc-router is down, the port forward is gone. So while AMP says Running, api asks
// the game for its server-list status the way a player's game does, at the address players join by (SERVER_ADDRESS,
// through the home router and mc-router), every 30 s. Three misses in a row and the server is "Not answering"
// (shared/server-state.ts) on the site, the app and the bot; one answer and it is well again.
//
// The status answer comes from the game's network thread: a main thread that hangs but still answers here is not
// caught. A crash, a dead process and anything between the internet and the game are.

export const GAME_PING_EVERY_MS = 30_000;
export const GAME_PING_TIMEOUT_MS = 5_000;
export const MISSES_TO_DOWN = 3;
const PROTOCOL = 767; // 1.21.1; mc-router reads only the host name, the game answers a status request at any number

export type GamePing = { ok: true; ms: number; online: number | null } | { ok: false; error: string };

/** "mc.dsw.test" or "mc.dsw.test:25566" → host and port; null for an empty or odd address. */
export function gameAddress(raw: string | undefined | null): { host: string; port: number } | null {
  const m = /^\s*([A-Za-z0-9.-]+)(?::(\d{1,5}))?\s*$/.exec(raw ?? "");
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : 25565;
  return port > 0 && port < 65536 ? { host: m[1]!, port } : null;
}

function varint(n: number): Buffer {
  const out: number[] = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}

const packet = (id: number, ...parts: Buffer[]) => {
  const body = Buffer.concat([varint(id), ...parts]);
  return Buffer.concat([varint(body.length), body]);
};

/** Pure: the handshake (next state: status) and the status request, as one write. */
export function statusRequest(host: string, port: number): Buffer {
  const name = Buffer.from(host, "utf8");
  const p = Buffer.alloc(2);
  p.writeUInt16BE(port);
  return Buffer.concat([packet(0, varint(PROTOCOL), varint(name.length), name, p, varint(1)), packet(0)]);
}

/** Reads a varint at `at`; null while the bytes are not all there yet. */
function readVarint(b: Buffer, at: number): { value: number; next: number } | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (at + i >= b.length) return null;
    const byte = b[at + i]!;
    value |= (byte & 0x7f) << (7 * i);
    if (!(byte & 0x80)) return { value, next: at + i + 1 };
  }
  throw new Error("bad varint");
}

/** Pure: the status answer's JSON once the whole packet is in; null while more is to come. Throws on a wrong packet. */
export function readStatus(b: Buffer): { online: number | null } | null {
  const len = readVarint(b, 0);
  if (!len || b.length < len.next + len.value) return null;
  const id = readVarint(b, len.next);
  if (!id || id.value !== 0) throw new Error("not a status answer");
  const str = readVarint(b, id.next);
  if (!str) throw new Error("not a status answer");
  const json = JSON.parse(b.subarray(str.next, str.next + str.value).toString("utf8")) as { players?: { online?: unknown } };
  return { online: typeof json.players?.online === "number" ? json.players.online : null };
}

/** One server-list status request; never throws. */
export function pingGame(host: string, port: number, timeoutMs = GAME_PING_TIMEOUT_MS): Promise<GamePing> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let got = Buffer.alloc(0);
    const s = connect({ host, port });
    const done = (r: GamePing) => {
      s.destroy();
      resolve(r);
    };
    s.setTimeout(timeoutMs, () => done({ ok: false, error: got.length ? "the answer stopped halfway" : "no answer" }));
    s.once("connect", () => s.write(statusRequest(host, port)));
    s.on("data", (d) => {
      got = Buffer.concat([got, d]);
      try {
        const r = readStatus(got);
        if (r) done({ ok: true, ms: Date.now() - t0, online: r.online });
      } catch (e) {
        done({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    });
    s.once("end", () => done({ ok: false, error: "the connection was closed" }));
    s.once("error", (e: NodeJS.ErrnoException) => done({ ok: false, error: e.code ?? e.message }));
  });
}

/** Pure: after a round, how many misses in a row, and whether the game answers (null: not looked at or too soon to say). */
export function nextAnswering(prev: { misses: number; answering: boolean | null }, r: GamePing | null): { misses: number; answering: boolean | null } {
  if (r === null) return { misses: 0, answering: null }; // AMP does not say Running: nothing to ask
  if (r.ok) return { misses: 0, answering: true };
  const misses = prev.misses + 1;
  return { misses, answering: misses >= MISSES_TO_DOWN ? false : prev.answering };
}

export class GameWatch {
  answering: boolean | null = null;
  lastError: string | null = null;
  lastOk: Date | null = null;
  private misses = 0;
  private told = false;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private listeners: Array<(answering: boolean, error: string | null) => void> = [];

  constructor(
    private readonly address: { host: string; port: number },
    /** Does AMP say Running right now? The status poller's word. */
    private readonly running: () => boolean,
    private readonly log: (o: unknown, m: string) => void,
    private readonly ping: (host: string, port: number) => Promise<GamePing> = pingGame,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Called when the game goes from answering to not answering, and back. */
  onChange(fn: (answering: boolean, error: string | null) => void) {
    this.listeners.push(fn);
  }

  start() {
    this.timer = setInterval(() => void this.round(), GAME_PING_EVERY_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async round(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = this.running() ? await this.ping(this.address.host, this.address.port) : null;
      const next = nextAnswering({ misses: this.misses, answering: this.answering }, r);
      this.misses = next.misses;
      this.answering = next.answering;
      if (r?.ok) {
        this.lastOk = this.now();
        this.lastError = null;
      } else if (r) this.lastError = r.error;
      if (r && !r.ok && this.misses === 1) this.log({ err: r.error }, "game ping missed");
      // told once when it stops answering, and once when it answers again (after a restart too); a stop is not news
      const tell = next.answering === false && !this.told ? false : next.answering === true && this.told ? true : null;
      if (tell !== null) {
        this.told = !tell;
        for (const fn of this.listeners) fn(tell, this.lastError);
      }
    } finally {
      this.busy = false;
    }
  }
}
