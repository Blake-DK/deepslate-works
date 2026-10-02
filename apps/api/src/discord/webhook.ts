// docs/21 §3: the only place that calls Discord for the feed, as amp/ is for AMP. A webhook URL is a password for its
// channel: it is never logged, never returned to web and never written to the database (only a hash of it, so that a
// new URL in deploy/.env is noticed).
import { createHash } from "node:crypto";

const URL_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d{5,25})\/([\w-]{20,200})\/?$/;

export type Mentions = { parse: never[]; users?: string[] };
export type Embed = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  footer?: { text: string };
  image?: { url: string };
  thumbnail?: { url: string };
};
/** One message as Discord takes it. `allowed_mentions` is always set: nobody is pinged unless named in `users`. */
export type Message = {
  content?: string;
  embeds?: Embed[];
  username?: string;
  avatar_url?: string;
  flags?: number;
  allowed_mentions: Mentions;
};
export type Attachment = { name: string; type: string; data: Buffer };

export type Sent = { ok: true; id: string } | { ok: false; refused: boolean; dropped: boolean; status: number | null; error: string };

/** 4: suppress embeds, so a link in a line is not turned into a preview. */
export const SUPPRESS_EMBEDS = 4;

export function webhookHash(url: string | undefined): string {
  return url ? createHash("sha256").update(url).digest("hex").slice(0, 16) : "";
}

type Fetch = typeof fetch;
type Opts = { fetch?: Fetch; sleep?: (ms: number) => Promise<void>; now?: () => number; timeoutMs?: number; minGapMs?: number; botToken?: string };

export class Webhook {
  readonly valid: boolean;
  readonly hash: string;
  private readonly base: string;
  private readonly id: string;
  private nextAt = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly f: Fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly minGapMs: number;

  constructor(url: string, private readonly opts: Opts = {}) {
    const m = URL_RE.exec(url.trim());
    this.valid = Boolean(m);
    this.id = m?.[1] ?? "";
    this.base = m ? `https://discord.com/api/v10/webhooks/${m[1]}/${m[2]}` : "";
    this.hash = webhookHash(url);
    this.f = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.minGapMs = opts.minGapMs ?? 1000;
  }

  /** Post a message and get its id (`?wait=true`). With a picture, it goes as an attachment (`attachment://<name>`). */
  send(msg: Message, file?: Attachment): Promise<Sent> {
    return this.queue(() => this.request("POST", `${this.base}?wait=true`, msg, file));
  }

  /** Change a message this webhook posted earlier. */
  edit(messageId: string, msg: Message): Promise<Sent> {
    if (!/^\d{1,25}$/.test(messageId)) return Promise.resolve({ ok: false, refused: false, dropped: true, status: null, error: "no message to edit" });
    const rest: Message = { ...msg }; // an edit cannot change who sent it
    delete rest.username;
    delete rest.avatar_url;
    delete rest.flags;
    return this.queue(() => this.request("PATCH", `${this.base}/messages/${messageId}`, rest));
  }

  /** The webhook's own name and its channel's name (the channel's only with a bot token: a webhook cannot read it). */
  async info(): Promise<{ ok: true; name: string; channel: string | null } | { ok: false; refused: boolean; error: string }> {
    if (!this.valid) return { ok: false, refused: true, error: "not a Discord webhook address" };
    try {
      const res = await this.f(this.base, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (res.status === 401 || res.status === 403 || res.status === 404) return { ok: false, refused: true, error: `Discord answered ${res.status}` };
      if (!res.ok) return { ok: false, refused: false, error: `Discord answered ${res.status}` };
      const j = (await res.json()) as { name?: string; channel_id?: string };
      let channel: string | null = null;
      if (this.opts.botToken && j.channel_id) {
        const c = await this.f(`https://discord.com/api/v10/channels/${j.channel_id}`, { headers: { authorization: `Bot ${this.opts.botToken}` }, signal: AbortSignal.timeout(this.timeoutMs) }).catch(() => null);
        if (c?.ok) channel = ((await c.json()) as { name?: string }).name ?? null;
      }
      return { ok: true, name: j.name ?? "", channel };
    } catch (e) {
      return { ok: false, refused: false, error: errText(e) };
    }
  }

  /** One request at a time per webhook, and never more than one a second (§3). */
  private queue(job: () => Promise<Sent>): Promise<Sent> {
    const run = this.chain.then(async () => {
      const wait = this.nextAt - this.now();
      if (wait > 0) await this.sleep(wait);
      try {
        return await job();
      } finally {
        this.nextAt = this.now() + this.minGapMs;
      }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** 429: wait what Discord says and again (5 times at most). Network error or 5xx: 3 tries with a pause. */
  private async request(method: "POST" | "PATCH", url: string, msg: Message, file?: Attachment): Promise<Sent> {
    if (!this.valid) return { ok: false, refused: true, dropped: true, status: null, error: "not a Discord webhook address" };
    let failures = 0;
    let limited = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.f(url, { method, ...body(msg, file), signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (e) {
        if (++failures >= 3) return { ok: false, refused: false, dropped: false, status: null, error: errText(e) };
        await this.sleep(2000 * failures);
        continue;
      }
      if (res.ok) {
        const j = (await res.json().catch(() => null)) as { id?: string } | null;
        return { ok: true, id: j?.id ?? "" };
      }
      if (res.status === 429) {
        if (++limited > 5) return { ok: false, refused: false, dropped: false, status: 429, error: "Discord kept saying slow down" };
        const j = (await res.json().catch(() => null)) as { retry_after?: number } | null;
        const after = Number(j?.retry_after ?? res.headers.get("retry-after") ?? 1);
        await this.sleep(Math.min(60_000, Math.max(250, Math.ceil((Number.isFinite(after) ? after : 1) * 1000))));
        continue;
      }
      if (res.status >= 500) {
        if (++failures >= 3) return { ok: false, refused: false, dropped: false, status: res.status, error: `Discord answered ${res.status}` };
        await this.sleep(2000 * failures);
        continue;
      }
      const refused = res.status === 401 || res.status === 403 || (res.status === 404 && method === "POST");
      const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
      // anything else (400, a message edited after it was deleted) is this message's problem: it is dropped, not retried
      return { ok: false, refused, dropped: true, status: res.status, error: `Discord answered ${res.status}${detail ? `: ${detail}` : ""}` };
    }
  }

  toString() {
    return `webhook ${this.id || "(not valid)"}`;
  }
}

function body(msg: Message, file?: Attachment): { headers?: Record<string, string>; body: string | FormData } {
  if (!file) return { headers: { "content-type": "application/json" }, body: JSON.stringify(msg) };
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ ...msg, attachments: [{ id: 0, filename: file.name }] }));
  form.append("files[0]", new Blob([new Uint8Array(file.data)], { type: file.type }), file.name);
  return { body: form };
}

function errText(e: unknown): string {
  const err = e as { name?: string; cause?: { code?: string }; message?: string };
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return "no answer from Discord in time";
  return String(err?.cause?.code ?? err?.message ?? e).slice(0, 200);
}
