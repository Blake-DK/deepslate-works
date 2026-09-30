import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import { runAction } from "../actions/run.js";
import type { ActionCtx } from "../actions/registry.js";

// Who is on is read from the console: joins and leaves as they happen. After a restart of api the console is
// AMP's last forty lines, and a join from before them is not among them: on 2026-09-29 17:45 UTC the portal took
// a server with bramble09 on it for empty, asked for no pings and let the map render carry on. AMP keeps its own
// list of players; whenever that and the console's differ, the server is asked (`list`) and its answer, which
// the console tail reads like any line, puts the console's list right.

export const ASK_EVERY_MS = 20_000;
/** The same disagreement is asked about again only this long after, so a name AMP keeps is not asked about every 20 s. */
export const ASK_AGAIN_MS = 10 * 60_000;

/** Pure: do the two lists name other people? Names are compared without their case. */
export function differ(amp: readonly string[] | null, console: Iterable<string>): boolean {
  if (amp === null) return false; // AMP has not answered: nothing to go by
  const a = new Set(amp.map((n) => n.toLowerCase()));
  const c = new Set([...console].map((n) => n.toLowerCase()));
  return a.size !== c.size || [...a].some((n) => !c.has(n));
}

export class OnlineWatch {
  private timer: NodeJS.Timeout | null = null;
  asked = 0;
  private lastAsked: { amp: string; at: number } | null = null;

  constructor(
    private readonly amp: Amp,
    private readonly tail: ConsoleTail,
    private readonly ctx: () => ActionCtx,
    private readonly players: () => readonly string[] | null,
    private readonly log: (o: unknown, m: string) => void,
  ) {}

  start() {
    // old lines have just been read (api has started, or AMP has given a new session): they may not be the whole story
    this.tail.onResync(() => void this.ask("resync"));
    this.timer = setInterval(() => void this.check(), ASK_EVERY_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** `players`: AMP's own list. Asked when it disagrees with the console, once per disagreement (again after ASK_AGAIN_MS). */
  async check(now = Date.now()) {
    const amp = this.players();
    if (this.tail.state !== 20 || !differ(amp, this.tail.online)) return;
    const key = [...(amp ?? [])].map((n) => n.toLowerCase()).sort().join(",");
    if (this.lastAsked && this.lastAsked.amp === key && now - this.lastAsked.at < ASK_AGAIN_MS) return;
    this.lastAsked = { amp: key, at: now };
    await this.ask("differ");
  }

  async ask(why: string) {
    if (this.tail.state !== 20) return; // never to a server that is asleep or starting
    this.asked++;
    const r = await runAction(this.amp, this.ctx(), "server.list", {}, null).catch((e) => ({ ok: false, detail: String(e) }));
    this.log({ why, ok: r.ok, amp: this.players(), console: [...this.tail.online] }, "asked the server who is on");
  }
}
