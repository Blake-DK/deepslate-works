import type { Amp } from "./client.js";

// Tails the instance console through Core.GetUpdates (AMP returns only new entries per session) and
// turns the lines into events. Patterns verified against 1.21.1 NeoForge log formats.

export type ConsoleEvent =
  | { type: "uuid"; name: string; uuid: string }
  | { type: "join"; name: string }
  | { type: "leave"; name: string }
  | { type: "list"; online: number; max: number; names: string[] }
  | { type: "line"; text: string };

const RE = {
  uuid: /UUID of player (\S+) is ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  join: /\]: (\S+)\[\/[\d.:a-f]+\] logged in with entity id \d+/i,
  joinAlt: /\]: (\S+) joined the game/,
  leave: /\]: (\S+) (?:left the game|lost connection: .*)$/,
  list: /There are (\d+) of a max of (\d+) players online:\s*(.*)$/,
};

export function parseConsoleLine(text: string): ConsoleEvent[] {
  const out: ConsoleEvent[] = [{ type: "line", text }];
  let m: RegExpExecArray | null;
  if ((m = RE.uuid.exec(text))) out.push({ type: "uuid", name: m[1]!, uuid: m[2]!.toLowerCase() });
  else if ((m = RE.join.exec(text)) || (m = RE.joinAlt.exec(text))) out.push({ type: "join", name: m[1]! });
  else if ((m = RE.leave.exec(text))) out.push({ type: "leave", name: m[1]! });
  else if ((m = RE.list.exec(text))) out.push({ type: "list", online: Number(m[1]), max: Number(m[2]), names: m[3]!.split(",").map((s) => s.trim()).filter(Boolean) });
  return out;
}

type Entry = { Timestamp?: string; Source?: string; Type?: string; Contents?: string };
type Updates = { Status?: { State?: number }; ConsoleEntries?: Entry[] };

export type ConsoleEntry = { seq: number; at: string; text: string };
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
  ingest(text: string, at: Date = new Date()) {
    this.entries.push({ seq: ++this.seq, at: at.toISOString(), text });
    if (this.entries.length > KEEP) this.entries.splice(0, this.entries.length - KEEP);
    for (const e of parseConsoleLine(text)) {
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
        if (text) this.ingest(text);
      }
    } finally {
      this.busy = false;
    }
  }
}
