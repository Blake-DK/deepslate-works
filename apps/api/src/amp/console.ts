import type { Amp } from "./client.js";
import { isCountChatter, isEntityDump, isMapChatter, isPingChatter, isTpsLine, parse, type GameEvent, type Meta } from "../events/parse.js";

// Tails the instance console through Core.GetUpdates (AMP returns only new entries per session) and
// turns the lines into events. The patterns are in src/events/parse.ts.

export type ConsoleEvent = GameEvent | { type: "line"; text: string; source: string | null; kind: string | null };

export function parseConsoleLine(text: string, meta: Meta = {}, isPlayer?: (name: string) => boolean): ConsoleEvent[] {
  return [{ type: "line", text, source: meta.source ?? null, kind: meta.type ?? null }, ...parse(text, meta, isPlayer)];
}

type Entry = { Timestamp?: string; Source?: string; Type?: string; Contents?: string };

/** `replay`: a line from before this process was listening, read for the record and the player list, not to act on. */
export type EventInfo = { replay: boolean };
export type ConsoleHandler = (e: ConsoleEvent, info: EventInfo) => void;

const keyOf = (e: Entry) => `${e.Timestamp ?? ""}\u0000${e.Source ?? ""}\u0000${e.Contents ?? ""}`;
const SEEN = 600;
type Updates = { Status?: { State?: number }; ConsoleEntries?: Entry[] };

export type ConsoleEntry = { seq: number; at: string; text: string; source: string | null; kind: string | null };
const KEEP = 300;

export class ConsoleTail {
  /** Last 300 console lines, oldest first; `seq` only ever grows, so a reader can ask for "everything after n". */
  readonly entries: ConsoleEntry[] = [];
  private seq = 0;
  readonly uuidByName = new Map<string, string>();
  readonly online = new Set<string>();
  /**
   * When the server last answered `list` (its own word on who is on); null until it has since the server came up.
   * From then on `online` is what counts: AMP's own list can keep a name the server never let in (2026-09-29 22:44,
   * m1_owl turned away three times for the wrong NeoForge stayed in AMP's list for hours).
   */
  listedAt: number | null = null;
  state = -1;
  private handlers: ConsoleHandler[] = [];
  private resyncHandlers: Array<() => void> = [];
  /** The AMP session the last batch came from; another one means AMP starts from its backlog again. */
  private session: number | null = null;
  private seen = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private hushMapUntil = 0;
  private hushTpsUntil = 0;
  private hushCountUntil = 0;

  constructor(private readonly amp: Amp, private readonly log: (o: unknown, msg: string) => void) {}

  get lines(): string[] {
    return this.entries.map((e) => e.text);
  }

  on(handler: ConsoleHandler) {
    this.handlers.push(handler);
  }

  /** Called after a batch of old lines has been read: who is online is known again, nothing has been acted on. */
  onResync(handler: () => void) {
    this.resyncHandlers.push(handler);
  }

  /** The portal is about to ask BlueMap where it stands: for so long, the answer is read but not kept for the console page. */
  hushMap(ms: number) {
    this.hushMapUntil = Date.now() + ms;
  }

  /** Likewise for the answer to `neoforge tps` that the Settings card asks for while it is open. */
  hushTps(ms: number) {
    this.hushTpsUntil = Date.now() + ms;
  }

  /** Likewise for the entity counts and the steps of clearing items on the ground (status/ground.ts). */
  hushCount(ms: number) {
    this.hushCountUntil = Date.now() + ms;
  }

  off(handler: ConsoleHandler) {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  /** Entries after `since` (exclusive), at most `max` of the newest. */
  after(since: number, max = 200): ConsoleEntry[] {
    const out = this.entries.filter((e) => e.seq > since);
    return out.length > max ? out.slice(-max) : out;
  }

  /** Adds one console line and notifies the handlers; `poll` calls it for every new AMP entry. */
  ingest(text: string, at: Date = new Date(), meta: Meta = {}, replay = false) {
    // The answers to the ping rounds are read below like any line, but not kept for the console page.
    if (!isPingChatter(text) && !isEntityDump(text) && !(Date.now() < this.hushMapUntil && isMapChatter(text)) && !(Date.now() < this.hushTpsUntil && isTpsLine(text)) && !(Date.now() < this.hushCountUntil && isCountChatter(text))) this.entries.push({ seq: ++this.seq, at: at.toISOString(), text, source: meta.source ?? null, kind: meta.type ?? null });
    if (this.entries.length > KEEP) this.entries.splice(0, this.entries.length - KEEP);
    const known = (name: string) => this.online.has(name) || this.uuidByName.has(name);
    for (const e of parseConsoleLine(text, meta, known)) {
      if (e.type === "uuid") this.uuidByName.set(e.name, e.uuid);
      if (e.type === "join") this.online.add(e.name);
      if (e.type === "leave") this.online.delete(e.name);
      if (e.type === "list") {
        this.listedAt = Date.now();
        this.online.clear();
        for (const n of e.names) this.online.add(n);
      }
      for (const h of [...this.handlers]) {
        try {
          h(e, { replay });
        } catch (err) {
          this.log({ err: String(err) }, "console handler failed");
        }
      }
    }
  }

  start() {
    const loop = async () => {
      await this.poll().catch((e) => this.log({ err: String(e) }, "console poll failed"));
      const running = this.state === 20 || this.state === 10;
      this.timer = setTimeout(loop, running ? 2000 : 15000);
    };
    void loop();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  private remember(key: string) {
    this.seen.delete(key); // moved to the end: the set keeps the newest
    this.seen.add(key);
    if (this.seen.size > SEEN) for (const k of this.seen) { this.seen.delete(k); if (this.seen.size <= SEEN) break; }
  }

  async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const u = await this.amp.call<Updates>("Core", "GetUpdates");
      const prev = this.state;
      this.state = typeof u.Status?.State === "number" ? u.Status.State : this.state;
      if (prev === 20 && this.state !== 20) {
        this.online.clear(); // server went down: everyone is gone
        this.listedAt = null;
      }
      // The first batch of an AMP session is AMP's backlog, not news. Lines already read are dropped; the rest
      // (after a restart of api: all of them) are read as history.
      const session = this.amp.sessions ?? 0;
      const backlog = this.session === null || session !== this.session;
      const first = this.session === null;
      this.session = session;
      let replayed = 0;
      for (const entry of u.ConsoleEntries ?? []) {
        const text = entry.Contents ?? "";
        if (!text) continue;
        const key = keyOf(entry);
        const known = this.seen.has(key);
        this.remember(key);
        if (backlog && known) continue;
        const replay = backlog && (first || !entry.Timestamp);
        if (replay) replayed++;
        this.ingest(text, new Date(), { source: entry.Source ?? null, type: entry.Type ?? null }, replay);
      }
      if (backlog) {
        this.log({ session, entries: (u.ConsoleEntries ?? []).length, replayed }, "console: new AMP session, backlog read");
        for (const h of [...this.resyncHandlers]) {
          try {
            h();
          } catch (err) {
            this.log({ err: String(err) }, "console resync handler failed");
          }
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
