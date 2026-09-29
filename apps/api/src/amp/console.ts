import type { Amp } from "./client.js";
import { parse, type GameEvent, type Meta } from "../events/parse.js";

// Tails the instance console through Core.GetUpdates (AMP returns only new entries per session) and
// turns the lines into events. The patterns are in src/events/parse.ts.

export type ConsoleEvent = GameEvent | { type: "line"; text: string; source: string | null; kind: string | null };

export function parseConsoleLine(text: string, meta: Meta = {}, isPlayer?: (name: string) => boolean): ConsoleEvent[] {
  return [{ type: "line", text, source: meta.source ?? null, kind: meta.type ?? null }, ...parse(text, meta, isPlayer)];
}

type Entry = { Timestamp?: string; Source?: string; Type?: string; Contents?: string };
type Updates = { Status?: { State?: number }; ConsoleEntries?: Entry[] };

export type ConsoleEntry = { seq: number; at: string; text: string; source: string | null; kind: string | null };
const KEEP = 300;

export class ConsoleTail {
  /** Last 300 console lines, oldest first; `seq` only ever grows, so a reader can ask for "everything after n". */
  readonly entries: ConsoleEntry[] = [];
  private seq = 0;
  readonly uuidByName = new Map<string, string>();
  readonly online = new Set<string>();
  state = -1;
  private handlers: Array<(e: ConsoleEvent) => void> = [];
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(private readonly amp: Amp, private readonly log: (o: unknown, msg: string) => void) {}

  get lines(): string[] {
    return this.entries.map((e) => e.text);
  }

  on(handler: (e: ConsoleEvent) => void) {
    this.handlers.push(handler);
  }

  off(handler: (e: ConsoleEvent) => void) {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  /** Entries after `since` (exclusive), at most `max` of the newest. */
  after(since: number, max = 200): ConsoleEntry[] {
    const out = this.entries.filter((e) => e.seq > since);
    return out.length > max ? out.slice(-max) : out;
  }

  /** Adds one console line and notifies the handlers; `poll` calls it for every new AMP entry. */
  ingest(text: string, at: Date = new Date(), meta: Meta = {}) {
    this.entries.push({ seq: ++this.seq, at: at.toISOString(), text, source: meta.source ?? null, kind: meta.type ?? null });
    if (this.entries.length > KEEP) this.entries.splice(0, this.entries.length - KEEP);
    const known = (name: string) => this.online.has(name) || this.uuidByName.has(name);
    for (const e of parseConsoleLine(text, meta, known)) {
      if (e.type === "uuid") this.uuidByName.set(e.name, e.uuid);
      if (e.type === "join") this.online.add(e.name);
      if (e.type === "leave") this.online.delete(e.name);
      if (e.type === "list") {
        this.online.clear();
        for (const n of e.names) this.online.add(n);
      }
      for (const h of [...this.handlers]) {
        try {
          h(e);
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

  async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const u = await this.amp.call<Updates>("Core", "GetUpdates");
      const prev = this.state;
      this.state = typeof u.Status?.State === "number" ? u.Status.State : this.state;
      if (prev === 20 && this.state !== 20) {
        this.online.clear(); // server went down: everyone is gone
      }
      for (const entry of u.ConsoleEntries ?? []) {
        const text = entry.Contents ?? "";
        if (text) this.ingest(text, new Date(), { source: entry.Source ?? null, type: entry.Type ?? null });
      }
    } finally {
      this.busy = false;
    }
  }
}
