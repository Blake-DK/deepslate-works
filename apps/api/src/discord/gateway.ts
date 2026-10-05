// docs/22 §3: the bot's own outgoing connection to Discord's gateway. Identify, heartbeat, resume and reconnect with
// back-off, on Node's built-in WebSocket (no library). Its failures are its own: nothing else waits on it.

export const INTENTS = { GUILDS: 1 << 0, GUILD_MEMBERS: 1 << 1, GUILD_MESSAGES: 1 << 9, MESSAGE_CONTENT: 1 << 15 } as const;
const ALL = INTENTS.GUILDS | INTENTS.GUILD_MEMBERS | INTENTS.GUILD_MESSAGES | INTENTS.MESSAGE_CONTENT;
const PRIVILEGED = INTENTS.GUILD_MEMBERS | INTENTS.MESSAGE_CONTENT;
const URL_DEFAULT = "wss://gateway.discord.gg";

export type GatewayState = "connecting" | "on" | "reconnecting" | "refused" | "stopped";
export type Presence = { text: string; status: "online" | "idle" | "dnd" };
type Socket = { send(data: string): void; close(code?: number): void; onopen: (() => void) | null; onmessage: ((ev: { data: unknown }) => void) | null; onclose: ((ev: { code: number; reason?: string }) => void) | null; onerror: ((ev: unknown) => void) | null };
type Payload = { op: number; d?: unknown; s?: number | null; t?: string | null };

export type GatewayDeps = {
  token: string;
  onDispatch: (type: string, data: unknown) => void;
  log: (o: unknown, m: string) => void;
  socket?: (url: string) => Socket;
  setTimer?: (fn: () => void, ms: number) => { cancel(): void };
  random?: () => number;
};

/** Close codes after which identifying again cannot help (docs: gateway close event codes). */
const FATAL = new Set([4004, 4010, 4011, 4012, 4013]);

export class Gateway {
  state: GatewayState = "stopped";
  /** Privileged intents Discord refused (4014): the bot runs without them and the card says which to switch on. */
  missingIntents = false;
  refusedReason: string | null = null;
  user: { id: string; tag: string } | null = null;
  applicationId: string | null = null;
  private ws: Socket | null = null;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private heartbeat: { cancel(): void } | null = null;
  private retry: { cancel(): void } | null = null;
  private acked = true;
  private attempts = 0;
  private presence: Presence | null = null;
  private stopping = false;
  private readonly socket: (url: string) => Socket;
  private readonly setTimer: (fn: () => void, ms: number) => { cancel(): void };
  private readonly random: () => number;

  constructor(private readonly d: GatewayDeps) {
    this.socket = d.socket ?? ((url) => new WebSocket(url) as unknown as Socket);
    this.setTimer = d.setTimer ?? ((fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return { cancel: () => clearTimeout(t) }; });
    this.random = d.random ?? Math.random;
  }

  start() {
    this.stopping = false;
    this.open(false);
  }

  stop() {
    this.stopping = true;
    this.state = "stopped";
    this.heartbeat?.cancel();
    this.retry?.cancel();
    try {
      this.ws?.close(1000);
    } catch {
      // already closed
    }
    this.ws = null;
  }

  /** The bot's status line; sent now if connected, and again after every (re)connect. */
  setPresence(p: Presence) {
    this.presence = p;
    if (this.state === "on") this.send({ op: 3, d: this.presenceData() });
  }

  private presenceData() {
    const p = this.presence;
    return { since: null, afk: false, status: p?.status ?? "online", activities: p ? [{ name: "Custom Status", type: 4, state: p.text.slice(0, 128) }] : [] };
  }

  private send(p: Payload) {
    try {
      this.ws?.send(JSON.stringify(p));
    } catch (e) {
      this.d.log({ err: String(e) }, "discord gateway: send failed");
    }
  }

  private open(resume: boolean) {
    this.heartbeat?.cancel();
    this.state = this.attempts === 0 && !resume ? "connecting" : "reconnecting";
    const base = resume && this.resumeUrl ? this.resumeUrl : URL_DEFAULT;
    let ws: Socket;
    try {
      ws = this.socket(`${base}/?v=10&encoding=json`);
    } catch (e) {
      this.d.log({ err: String(e) }, "discord gateway: could not open");
      return this.later(false);
    }
    this.ws = ws;
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let p: Payload;
      try {
        p = JSON.parse(String(ev.data)) as Payload;
      } catch {
        return;
      }
      try {
        this.onPayload(p, resume);
      } catch (e) {
        // a frame that is not what Discord documents (no `d`, not an object): nothing may throw out of the socket's listener
        this.d.log({ err: String(e) }, "discord gateway: a frame could not be read, reconnecting");
        this.drop(4000, true);
      }
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.onClose(ev.code, ev.reason ?? "");
    };
    ws.onerror = () => undefined; // a close follows
  }

  private onPayload(p: Payload, resume: boolean) {
    if (typeof p.s === "number") this.seq = p.s;
    switch (p.op) {
      case 10: {
        // Hello: heartbeat at the interval, the first after a random part of it; then identify or resume
        const every = Number((p.d as { heartbeat_interval?: number }).heartbeat_interval ?? 41_250);
        this.acked = true;
        this.beat(Math.floor(every * this.random()), every);
        if (resume && this.sessionId) this.send({ op: 6, d: { token: this.d.token, session_id: this.sessionId, seq: this.seq } });
        else this.identify();
        return;
      }
      case 11:
        this.acked = true;
        return;
      case 1:
        this.send({ op: 1, d: this.seq });
        return;
      case 7: // Discord asks for a reconnect: resume
        return this.drop(4000, true);
      case 9: // invalid session: resumable or not, wait 1 to 5 s as Discord asks
        this.sessionId = (p.d as boolean) ? this.sessionId : null;
        if (!p.d) this.seq = null;
        this.retry = this.setTimer(() => (p.d ? this.send({ op: 6, d: { token: this.d.token, session_id: this.sessionId, seq: this.seq } }) : this.identify()), 1000 + Math.floor(this.random() * 4000));
        return;
      case 0:
        this.dispatch(String(p.t), p.d);
        return;
    }
  }

  private identify() {
    const intents = this.missingIntents ? ALL & ~PRIVILEGED : ALL;
    this.send({ op: 2, d: { token: this.d.token, intents, properties: { os: "linux", browser: "deepslate-works", device: "deepslate-works" }, presence: this.presenceData() } });
  }

  private dispatch(type: string, data: unknown) {
    if (type === "READY") {
      const r = data as { session_id: string; resume_gateway_url?: string; user: { id: string; username: string; discriminator?: string }; application?: { id: string } };
      this.sessionId = r.session_id;
      this.resumeUrl = r.resume_gateway_url ?? null;
      this.user = { id: r.user.id, tag: r.user.discriminator && r.user.discriminator !== "0" ? `${r.user.username}#${r.user.discriminator}` : r.user.username };
      this.applicationId = r.application?.id ?? null;
      this.markUp();
    } else if (type === "RESUMED") this.markUp();
    try {
      this.d.onDispatch(type, data);
    } catch (e) {
      this.d.log({ err: String(e), type }, "discord gateway: handler failed");
    }
  }

  private markUp() {
    this.state = "on";
    this.attempts = 0;
    this.refusedReason = null;
    if (this.presence) this.send({ op: 3, d: this.presenceData() });
  }

  private beat(first: number, every: number) {
    this.heartbeat?.cancel();
    this.heartbeat = this.setTimer(() => {
      if (!this.acked) return this.drop(4000, true); // no answer to the last beat: the connection is dead
      this.acked = false;
      this.send({ op: 1, d: this.seq });
      this.beat(every, every);
    }, first);
  }

  /** Close our side and come back: resuming where we were when we can. */
  private drop(code: number, resume: boolean) {
    const ws = this.ws;
    this.ws = null;
    this.heartbeat?.cancel();
    try {
      ws?.close(code);
    } catch {
      // gone already
    }
    this.later(resume);
  }

  private onClose(code: number, reason: string) {
    this.heartbeat?.cancel();
    if (this.stopping) return;
    if (code === 4014 && !this.missingIntents) {
      // a privileged intent is not switched on in the Developer Portal: carry on without them
      this.missingIntents = true;
      this.d.log({ code }, "discord gateway: privileged intents not allowed, running without them");
      this.sessionId = null;
      return this.later(false);
    }
    if (FATAL.has(code) || code === 4014) {
      this.state = "refused";
      this.refusedReason = code === 4004 ? "token" : code === 4014 ? "intents" : `close ${code}`;
      this.d.log({ code, reason }, "discord gateway: refused, not reconnecting");
      return;
    }
    // 4007 bad sequence, 4009 session timed out: a new session; anything else: resume
    const resume = code !== 4007 && code !== 4009 && this.sessionId !== null;
    if (!resume) [this.sessionId, this.seq] = [null, null];
    this.later(resume);
  }

  private later(resume: boolean) {
    if (this.stopping) return;
    this.state = "reconnecting";
    this.attempts++;
    const wait = Math.min(60_000, 1000 * 2 ** Math.min(this.attempts - 1, 6)) + Math.floor(this.random() * 1000);
    this.retry?.cancel();
    this.retry = this.setTimer(() => this.open(resume), this.attempts === 1 && resume ? 0 : wait);
  }
}
