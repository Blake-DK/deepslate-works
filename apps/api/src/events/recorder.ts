import type { ConsoleEvent } from "../amp/console.js";
import type { LiveStatus } from "../status/poller.js";
import type { EventKind } from "../shared/events.js";
import { redact } from "./parse.js";

// docs/16 §1: turns what the console says and what the status poller sees into Session and Event rows.
// Everything is handled one at a time, in the order it arrived, so a join is always stored before the
// chat line that follows it.

export type NewEvent = { at: Date; kind: EventKind; actor: string | null; message: string; raw?: string | null; meta?: Record<string, unknown> | null };
export type OpenSession = { id: string; mcUuid: string; mcName: string; joinedAt: Date; ip: string | null };
export type NewSession = { mcUuid: string; mcName: string; userId: string | null; joinedAt: Date; ip: string | null; country: string | null };

export type RecorderStore = {
  userIdByUuid(uuid: string): Promise<string | null>;
  uuidByName(name: string): Promise<string | null>;
  openSessions(): Promise<OpenSession[]>;
  openSession(s: NewSession): Promise<OpenSession>;
  closeSession(id: string, leftAt: Date): Promise<void>;
  setSessionAddress(id: string, ip: string, country: string | null): Promise<void>;
  /** Rows stored under "name:<lowercase name>" get the real UUID once it is known. */
  adoptUuid(name: string, uuid: string): Promise<void>;
  addEvent(e: NewEvent): Promise<string>;
  bumpEvent(id: string): Promise<void>;
};

export type RecorderDeps = {
  store: RecorderStore;
  privacy: () => Promise<{ geo: boolean; chat: boolean }>;
  country: (ip: string | null) => Promise<string | null>;
  uuidOf: (name: string) => string | undefined;
  log: (o: unknown, msg: string) => void;
  now?: () => Date;
};

const DEDUPE_MS = 60_000;
const STOP_LINE_MS = 120_000;
const START_LINE_MS = 180_000;
const MISSING_POLLS = 3;
/**
 * How long a server that went down is watched before it is called a crash. The console tail and the status poller
 * run on their own clocks (2 s and 10 s; the tail slows to 15 s once the server is not running), so the poller can
 * see the server gone before the tail has read "Stopping the server". 2026-09-29 17:02: AMP put the server to sleep
 * with a clean stop in the log, and it was written down as a crash.
 */
const SETTLE_MS = 90_000;

export const placeholder = (name: string) => `name:${name.toLowerCase()}`;

export function duration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return "under a minute";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

const ADVANCEMENT = { advancement: "has made the advancement", challenge: "has completed the challenge", goal: "has reached the goal" } as const;

export class Recorder {
  private chain: Promise<void> = Promise.resolve();
  private open = new Map<string, OpenSession>(); // by lowercase name
  private missing = new Map<string, number>();
  private recent = new Map<string, { id: string; at: number }>();
  private raw: string | null = null;
  private lastStopLine = 0;
  private lastStart = 0;
  /** The server went down at `at` and what it was is not known yet (see `settle`). */
  /** How the server last went down, once it is known (docs/13 §12: "Crashed" is this, not a guess). Null while up. */
  lastDown: "crash" | "stop" | "sleep" | "restart" | null = null;
  private down: { at: number; state: string } | null = null;
  private readonly now: () => Date;

  constructor(private readonly d: RecorderDeps) {
    this.now = d.now ?? (() => new Date());
  }

  /** Sessions left open by a previous run of api are picked up again; the poller closes the ones that are gone. */
  async init() {
    for (const s of await this.d.store.openSessions()) this.open.set(s.mcName.toLowerCase(), s);
  }

  get openCount() {
    return this.open.size;
  }

  onConsole = (e: ConsoleEvent, info?: { replay: boolean }) => {
    // Old lines, read again after a restart: they were recorded when they were new. Who is online is put right
    // from AMP's player list (see `status`). The UUIDs in them are still worth having.
    if (info?.replay && e.type !== "uuid" && e.type !== "line") return;
    this.enqueue(() => this.console(e));
  };

  onStatus = (next: LiveStatus, prev: LiveStatus | null) => {
    this.enqueue(() => this.status(next, prev));
  };

  /** Resolves when everything queued so far has been written. */
  idle(): Promise<void> {
    return this.chain;
  }

  private enqueue(fn: () => Promise<void>) {
    this.chain = this.chain.then(fn).catch((err) => this.d.log({ err: String(err) }, "event recorder failed"));
  }

  private async actorFor(name: string): Promise<string> {
    return this.d.uuidOf(name) ?? (await this.d.store.uuidByName(name)) ?? placeholder(name);
  }

  private async console(e: ConsoleEvent) {
    const at = this.now();
    switch (e.type) {
      case "line":
        this.raw = redact(e.text).slice(0, 1000);
        return;
      case "uuid": {
        await this.d.store.adoptUuid(e.name, e.uuid);
        const s = this.open.get(e.name.toLowerCase());
        if (s && s.mcUuid !== e.uuid) s.mcUuid = e.uuid;
        return;
      }
      case "join":
        return this.join(e.name, e.ip, at, false);
      case "leave":
        return this.leave(e.name, e.reason, at, false);
      case "list": {
        const here = new Set(e.names.map((n) => n.toLowerCase()));
        for (const [key, s] of [...this.open]) if (!here.has(key)) await this.leave(s.mcName, null, at, true);
        return;
      }
      case "chat": {
        if (!(await this.d.privacy()).chat) return;
        await this.d.store.addEvent({ at, kind: "CHAT", actor: await this.actorFor(e.name), message: `<${e.name}> ${e.text}`.slice(0, 500), raw: this.raw, meta: { name: e.name } });
        return;
      }
      case "death":
        await this.d.store.addEvent({ at, kind: "DEATH", actor: await this.actorFor(e.name), message: `${e.name} ${e.text}`.slice(0, 500), raw: this.raw, meta: { name: e.name } });
        return;
      case "advancement":
        await this.d.store.addEvent({ at, kind: "ADVANCEMENT", actor: await this.actorFor(e.name), message: `${e.name} ${ADVANCEMENT[e.how]} [${e.title}]`.slice(0, 500), raw: this.raw, meta: { name: e.name, how: e.how, title: e.title } });
        return;
      case "started":
        this.lastStart = at.getTime();
        await this.d.store.addEvent({ at, kind: "SERVER_START", actor: null, message: `Server online (started in ${e.seconds.toFixed(1)} s)`, raw: this.raw, meta: { seconds: e.seconds } });
        return;
      case "stopping":
        this.lastStopLine = at.getTime();
        return;
      case "problem": {
        const kind = e.level === "WARN" ? "WARN" : "ERROR";
        const key = `${kind}\n${e.text}`;
        const seen = this.recent.get(key);
        if (seen && at.getTime() - seen.at < DEDUPE_MS) {
          await this.d.store.bumpEvent(seen.id);
          return;
        }
        const id = await this.d.store.addEvent({ at, kind, actor: null, message: e.text, raw: this.raw, meta: e.logger ? { logger: e.logger } : null });
        this.recent.set(key, { id, at: at.getTime() });
        if (this.recent.size > 200) for (const [k, v] of this.recent) if (at.getTime() - v.at >= DEDUPE_MS) this.recent.delete(k);
        return;
      }
    }
  }

  private async join(name: string, ip: string | null, at: Date, inferred: boolean) {
    const key = name.toLowerCase();
    this.missing.delete(key);
    const existing = this.open.get(key);
    if (existing) {
      // "logged in with entity id" and "joined the game" are two lines for one join
      if (ip && !existing.ip) {
        const country = (await this.d.privacy()).geo ? await this.d.country(ip) : null;
        await this.d.store.setSessionAddress(existing.id, ip, country);
        existing.ip = ip;
      }
      return;
    }
    const mcUuid = await this.actorFor(name);
    const userId = mcUuid.startsWith("name:") ? null : await this.d.store.userIdByUuid(mcUuid);
    const country = ip && (await this.d.privacy()).geo ? await this.d.country(ip) : null;
    const session = await this.d.store.openSession({ mcUuid, mcName: name, userId, joinedAt: at, ip, country });
    this.open.set(key, session);
    await this.d.store.addEvent({ at, kind: "JOIN", actor: mcUuid, message: `${name} joined`, raw: inferred ? null : this.raw, meta: inferred ? { name, inferred: true } : { name } });
  }

  private async leave(name: string, reason: string | null, at: Date, inferred: boolean) {
    const key = name.toLowerCase();
    const s = this.open.get(key);
    this.missing.delete(key);
    if (!s) return; // the second of the two leave lines, or someone who never got in
    this.open.delete(key);
    await this.d.store.closeSession(s.id, at);
    const ms = at.getTime() - s.joinedAt.getTime();
    await this.d.store.addEvent({
      at, kind: "LEAVE", actor: s.mcUuid, message: `${s.mcName} left after ${duration(ms)}`, raw: inferred ? null : this.raw,
      meta: { name: s.mcName, minutes: Math.round(ms / 60_000), ...(reason ? { reason: reason.slice(0, 200) } : {}), ...(inferred ? { inferred: true } : {}) },
    });
  }

  /**
   * What the server did when it went down, written once it is known: asleep, restarting, stopped (a stop line was
   * read), or, only when none of these has shown after SETTLE_MS, a crash. A stop line anywhere around the fall
   * means it was not a crash. The row carries the time it went down.
   */
  private async settle(next: LiveStatus, now: Date) {
    const down = this.down!;
    const at = new Date(down.at);
    const said = this.lastStopLine > down.at - STOP_LINE_MS;
    const waited = now.getTime() - down.at >= SETTLE_MS;
    let message: string | null = null;
    let how: "sleep" | "restart" | "stop" | null = null;
    if (next.availability === "sleeping") [message, how] = ["Server asleep (nobody on)", "sleep"];
    else if (next.availability === "starting" || next.availability === "online") [message, how] = ["Server restarting", "restart"];
    else if (said && (next.stateCode === 0 || waited)) [message, how] = ["Server switched off", "stop"];
    if (message) {
      this.down = null;
      this.lastDown = how;
      await this.d.store.addEvent({ at, kind: "SERVER_STOP", actor: null, message, meta: { state: next.state, ...(said ? { stopLine: true } : {}) } });
      return;
    }
    if (!waited) return;
    this.down = null;
    this.lastDown = "crash";
    await this.d.store.addEvent({ at, kind: "CRASH", actor: null, message: "Server crashed (it went down without shutting down first)", meta: { state: next.state, wentDownAs: down.state } });
  }

  private async closeAll(at: Date) {
    for (const s of [...this.open.values()]) await this.leave(s.mcName, null, at, true);
  }

  private async status(next: LiveStatus, prev: LiveStatus | null) {
    const at = this.now();
    const was = prev?.availability === "online";
    const is = next.availability === "online";
    if (!is && this.open.size > 0) await this.closeAll(at);
    if (was && !is && !this.down) this.down = { at: at.getTime(), state: next.state };
    if (this.down) await this.settle(next, at);
    if (is) this.lastDown = null;
    if (prev && !was && is && at.getTime() - this.lastStart > START_LINE_MS) {
      this.lastStart = at.getTime();
      await this.d.store.addEvent({ at, kind: "SERVER_START", actor: null, message: "Server online", meta: { inferred: true } });
    }
    if (!is) return;
    // Reconcile with AMP's player list: it catches a join or a leave the console tail missed.
    const here = new Set(next.players.map((n) => n.toLowerCase()));
    for (const name of next.players) if (!this.open.has(name.toLowerCase())) await this.join(name, null, at, true);
    for (const [key, s] of [...this.open]) {
      if (here.has(key)) {
        this.missing.delete(key);
        continue;
      }
      const n = (this.missing.get(key) ?? 0) + 1;
      this.missing.set(key, n);
      if (n >= MISSING_POLLS) await this.leave(s.mcName, null, at, true);
    }
  }
}
