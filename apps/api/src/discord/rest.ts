// docs/22 §3: REST calls made with the bot token. With webhook.ts, the only code that calls Discord. The token is never
// logged and never leaves api.
import type { Embed, Mentions } from "./webhook.js";

const API = "https://discord.com/api/v10";

export type Component =
  | { type: 1; components: Component[] } // action row
  | { type: 2; style: 1 | 2 | 3 | 4 | 5; label: string; custom_id?: string; url?: string; disabled?: boolean } // button
  | { type: 3; custom_id: string; placeholder?: string; min_values?: number; max_values?: number; options: Array<{ label: string; value: string }> }; // select

export type BotMessage = { content?: string; embeds?: Embed[]; components?: Component[]; allowed_mentions: Mentions; flags?: number };
export type Rest = { ok: true; data: unknown } | { ok: false; status: number | null; code: number | null; error: string };

type Fetch = typeof fetch;
type Opts = { fetch?: Fetch; sleep?: (ms: number) => Promise<void>; timeoutMs?: number };

/** Discord's error codes the bot acts on. */
export const UNKNOWN_CHANNEL = 10003;
export const UNKNOWN_MESSAGE = 10008;
export const UNKNOWN_INTERACTION = 10062;

export class BotRest {
  private readonly f: Fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(private readonly token: string, opts: Opts = {}) {
    this.f = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /** One call: 429 waits what Discord says (3 times at most); a network error or 5xx is tried twice more. */
  async call(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown, auth = true): Promise<Rest> {
    let failures = 0;
    let limited = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.f(`${API}${path}`, {
          method,
          headers: { ...(auth ? { authorization: `Bot ${this.token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), "user-agent": "DiscordBot (https://github.com/Blake-DK/deepslate-works, 1.0)" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        if (++failures >= 3) return { ok: false, status: null, code: null, error: String((e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message ?? e).slice(0, 200) };
        await this.sleep(1000 * failures);
        continue;
      }
      if (res.status === 204) return { ok: true, data: null };
      const j = (await res.json().catch(() => null)) as { retry_after?: number; code?: number; message?: string } | null;
      if (res.ok) return { ok: true, data: j };
      if (res.status === 429 && ++limited <= 3) {
        await this.sleep(Math.min(30_000, Math.max(250, Math.ceil(Number(j?.retry_after ?? 1) * 1000))));
        continue;
      }
      if (res.status >= 500 && ++failures < 3) {
        await this.sleep(1000 * failures);
        continue;
      }
      return { ok: false, status: res.status, code: typeof j?.code === "number" ? j.code : null, error: `Discord answered ${res.status}${j?.message ? `: ${j.message}` : ""}`.slice(0, 200) };
    }
  }

  me() {
    return this.call("GET", "/users/@me");
  }
  channels(guild: string) {
    return this.call("GET", `/guilds/${guild}/channels`);
  }
  channel(id: string) {
    return this.call("GET", `/channels/${id}`);
  }
  registerCommands(app: string, guild: string, list: unknown[]) {
    return this.call("PUT", `/applications/${app}/guilds/${guild}/commands`, list);
  }
  /** A forum post: the thread and its first message in one call. */
  createPost(forum: string, name: string, message: BotMessage, tags: string[] = []) {
    return this.call("POST", `/channels/${forum}/threads`, { name: name.slice(0, 100), message, ...(tags.length ? { applied_tags: tags } : {}) });
  }
  send(channel: string, message: BotMessage) {
    return this.call("POST", `/channels/${channel}/messages`, message);
  }
  edit(channel: string, messageId: string, message: Partial<BotMessage>) {
    return this.call("PATCH", `/channels/${channel}/messages/${messageId}`, message);
  }
  react(channel: string, messageId: string, emoji: string) {
    return this.call("PUT", `/channels/${channel}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`);
  }
  pin(channel: string, messageId: string) {
    return this.call("PUT", `/channels/${channel}/pins/${messageId}`);
  }
  /** The answer to a button, a menu or a command (no token needed: the interaction's own token). */
  respond(interactionId: string, token: string, body: unknown) {
    return this.call("POST", `/interactions/${interactionId}/${token}/callback`, body, false);
  }
  editReply(app: string, token: string, message: Partial<BotMessage>) {
    return this.call("PATCH", `/webhooks/${app}/${token}/messages/@original`, message, false);
  }
}
