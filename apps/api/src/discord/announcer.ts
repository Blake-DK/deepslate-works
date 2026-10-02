// docs/21 §3: the Discord feed. Reads the event log after a cursor every 3 s and posts what `lines.ts` makes of each row
// to the feed's webhook (and crashes and problems to the admin one). Its own loop: a dead webhook or a Discord outage
// never slows the recorder, the door or a page.
import type { Attachment, Message, Sent, Webhook } from "./webhook.js";
import {
  actionOf, advancementText, asPlayer, asServer, backText, crashAdminText, crashFeedText, deathRun, deathText, isStale,
  joinText, leaveText, liveText, metaOf, newsMessage, packText, paramsOf, problemText, refusedText, reminderMessage,
  restartText, resultOf, stopText, TEST_TEXT, voteClosedText, voteMessage, welcomeText,
  type Brand, type Channel, type FeedEvent, type PollView, type Switches,
} from "./lines.js";

export type PostRow = { key: string; channel: Channel; messageId: string; postedAt: Date; editedAt: Date | null };
export type LogEntry = { at: string; channel: Channel; what: string; ok: boolean; error?: string };
export type FeedState = { cursor: string | null; hash: string; refused: Partial<Record<Channel, string>>; log: LogEntry[] };

export type FeedStore = {
  newestEventId(): Promise<bigint>;
  eventsAfter(id: bigint, limit: number): Promise<FeedEvent[]>;
  loadState(): Promise<FeedState | null>;
  saveState(s: FeedState): Promise<void>;
  /** A linked member's Minecraft account; null for anybody who has not linked (they are not named, §3). */
  member(uuid: string): Promise<{ userId: string } | null>;
  online(): Promise<number>;
  vote(kind: PollView["kind"], id: string): Promise<PollView | null>;
  /** Open votes with a closing date in the next 24 hours that were open before that mark. */
  remindable(now: Date): Promise<PollView[]>;
  unvoted(kind: PollView["kind"], id: string): Promise<{ discordIds: string[]; others: number }>;
  news(id: string): Promise<{ body: string; image: string | null } | null>;
  picture(file: string): Promise<Attachment | null>;
  /** What the last sync did to the pack (players/pack.ts). */
  packChange(): Promise<{ version: string; previous: string | null; changed: number; at: Date } | null>;
  post(key: string): Promise<PostRow | null>;
  savePost(row: PostRow): Promise<void>;
  addError(message: string, meta: Record<string, unknown>): Promise<void>;
  switches(): Promise<Switches>;
  brand(): Promise<Brand>;
};

type Deps = {
  store: FeedStore;
  feed: Webhook | null;
  admin: Webhook | null;
  portal: string; // https://deepslate.dsw.test
  log: (o: unknown, m: string) => void;
  now?: () => Date;
};

const ROUND_MS = 3000;
const BATCH = 50;
const SHORT_MS = 2 * 60_000; // a leave within 2 minutes of the join, a rejoin within 2 minutes of the leave
const RUN_MS = 5 * 60_000; // deaths of one player closer together than this are a run
const EDIT_GAP_MS = 60_000; // a vote's count is edited at most once a minute
const BACK_MS = 30 * 60_000; // "The server is back." only after a down line of ours this recent
const PROBLEM_REPEAT_MS = 6 * 60 * 60_000;
const PROBLEMS_PER_HOUR = 10;

type Outcome = { ok: true; id: string } | { ok: false; retry: boolean };

export class Announcer {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private st: FeedState | null = null;
  private dirtyState = false;
  /** Outputs of the event in hand already delivered, so that a retry does not post them twice. */
  private partial: { id: bigint; done: Set<number> } | null = null;
  private lastJoin = new Map<string, number>();
  private pendingLeaves = new Map<string, { name: string; at: number; due: number }>();
  private deaths = new Map<string, { count: number; lastAt: number; messageId: string; base: string }>();
  private dirtyVotes = new Set<string>();
  private downPostedAt: number | null = null;
  private problems = new Map<string, number>();
  private problemTimes: number[] = [];
  private remindedAt = 0;
  private readonly now: () => Date;

  constructor(private readonly d: Deps) {
    this.now = d.now ?? (() => new Date());
  }

  get configured(): boolean {
    return Boolean(this.d.feed || this.d.admin);
  }

  start() {
    if (!this.configured) return; // §11: with no webhook set, nothing changes anywhere
    const tick = () => void this.round().catch((err) => this.d.log({ err: String(err) }, "discord feed round failed"));
    this.timer = setInterval(tick, ROUND_MS);
    setTimeout(tick, 5000).unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** For /health: off (no feed webhook), refused (Discord said no to it) or on. */
  feedState(): "on" | "off" | "refused" {
    if (!this.d.feed) return "off";
    return !this.d.feed.valid || this.st?.refused.feed === this.d.feed.hash ? "refused" : "on";
  }

  private hookHash(): string {
    return `${this.d.feed?.hash ?? ""}:${this.d.admin?.hash ?? ""}`;
  }

  private async load(): Promise<FeedState> {
    if (this.st) return this.st;
    const saved = await this.d.store.loadState();
    const hash = this.hookHash();
    // First run, or a different webhook: start at the newest event. Switching the feed on never posts history.
    if (!saved || saved.hash !== hash || saved.cursor === null) {
      this.st = { cursor: (await this.d.store.newestEventId()).toString(), hash, refused: saved?.hash === hash ? saved.refused : {}, log: saved?.log ?? [] };
      this.dirtyState = true;
    } else this.st = saved;
    for (const ch of ["feed", "admin"] as const) {
      const hook = this.d[ch];
      if (hook && !hook.valid) await this.refuse(ch, "not a Discord webhook address");
    }
    return this.st;
  }

  async round(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const st = await this.load();
      const sw = await this.d.store.switches();
      if (sw.paused) {
        // nothing posted and nothing queued: the cursor moves on
        const newest = (await this.d.store.newestEventId()).toString();
        if (st.cursor !== newest) [st.cursor, this.dirtyState] = [newest, true];
        this.pendingLeaves.clear();
        this.dirtyVotes.clear();
        this.partial = null;
        return;
      }
      const events = await this.d.store.eventsAfter(BigInt(st.cursor ?? "0"), BATCH);
      for (const e of events) {
        const now = this.now();
        if (!isStale(e, now)) {
          const done = await this.handle(e, sw, now);
          if (!done) break; // Discord is away: this event again at the next round
        }
        st.cursor = e.id.toString();
        this.partial = null;
        this.dirtyState = true;
      }
      await this.duties(sw);
    } finally {
      if (this.dirtyState && this.st) {
        this.dirtyState = false;
        await this.d.store.saveState(this.st).catch((err) => this.d.log({ err: String(err) }, "discord feed: could not save its place"));
      }
      this.busy = false;
    }
  }

  // ---- delivering ---------------------------------------------------------------------------------------------------

  private record(entry: Omit<LogEntry, "at">) {
    if (!this.st) return;
    this.st.log = [{ at: this.now().toISOString(), ...entry }, ...this.st.log].slice(0, 20);
    this.dirtyState = true;
  }

  private async refuse(ch: Channel, error: string) {
    const hook = this.d[ch];
    if (!hook || !this.st || this.st.refused[ch] === hook.hash) return;
    this.st.refused[ch] = hook.hash;
    this.dirtyState = true;
    this.d.log({ channel: ch, error }, "discord feed: webhook refused");
    await this.d.store.addError(refusedText(ch), { discord: ch, error: error.slice(0, 200) }).catch(() => undefined);
  }

  private usable(ch: Channel): Webhook | null {
    const hook = this.d[ch];
    if (!hook || !hook.valid || this.st?.refused[ch] === hook.hash) return null;
    return hook;
  }

  private async outcome(ch: Channel, what: string, r: Sent): Promise<Outcome> {
    if (r.ok) {
      this.record({ channel: ch, what, ok: true });
      return { ok: true, id: r.id };
    }
    this.record({ channel: ch, what, ok: false, error: r.error });
    if (r.refused) await this.refuse(ch, r.error);
    return { ok: false, retry: !r.dropped && !r.refused };
  }

  /** Output number `n` of the event in hand: delivered at most once even if the event is tried again. */
  private async send(e: FeedEvent | null, n: number, ch: Channel, what: string, msg: Message, file?: Attachment): Promise<Outcome> {
    if (e && this.partial?.id === e.id && this.partial.done.has(n)) return { ok: true, id: "" };
    const hook = this.usable(ch);
    if (!hook) return { ok: false, retry: false };
    const r = await this.outcome(ch, what, await hook.send(msg, file));
    if (e && (r.ok || !r.retry)) {
      if (this.partial?.id !== e.id) this.partial = { id: e.id, done: new Set() };
      this.partial.done.add(n);
    }
    return r;
  }

  private async edit(ch: Channel, what: string, messageId: string, msg: Message): Promise<Outcome> {
    const hook = this.usable(ch);
    if (!hook) return { ok: false, retry: false };
    return this.outcome(ch, what, await hook.edit(messageId, msg));
  }

  /** Send a test line to one channel (Admin → Site settings → Discord). Works while paused, and on a refused webhook. */
  async test(ch: Channel): Promise<{ ok: boolean; error?: string }> {
    const hook = this.d[ch];
    if (!hook) return { ok: false, error: `no webhook set (DISCORD_WEBHOOK_${ch.toUpperCase()})` };
    await this.load();
    const brand = await this.d.store.brand();
    const r = await this.outcome(ch, "test", await hook.send(asServer(brand, TEST_TEXT)));
    if (r.ok && this.st?.refused[ch]) {
      delete this.st.refused[ch];
      this.dirtyState = true;
    }
    if (this.dirtyState && this.st) {
      this.dirtyState = false;
      await this.d.store.saveState(this.st).catch(() => undefined);
    }
    return r.ok ? { ok: true } : { ok: false, error: this.st?.log[0]?.error ?? "not taken" };
  }

  /** What the settings card shows. */
  async overview() {
    await this.load().catch(() => null);
    const one = async (ch: Channel) => {
      const hook = this.d[ch];
      if (!hook) return { state: "unset" as const };
      if (!hook.valid || this.st?.refused[ch] === hook.hash) return { state: "refused" as const };
      const info = await hook.info();
      if (!info.ok) return info.refused ? { state: "refused" as const } : { state: "unreachable" as const, error: info.error };
      return { state: "ok" as const, name: info.name, channel: info.channel };
    };
    const [feed, admin] = await Promise.all([one("feed"), one("admin")]);
    return { feed, admin, recent: this.st?.log ?? [] };
  }

  // ---- §4: one event ------------------------------------------------------------------------------------------------

  /** True when the event is dealt with (posted, or nothing to post); false to try it again at the next round. */
  private async handle(e: FeedEvent, sw: Switches, now: Date): Promise<boolean> {
    const brand = await this.d.store.brand();
    const meta = metaOf(e);
    const name = typeof meta.name === "string" ? meta.name : "";
    const ok = (o: Outcome) => o.ok || !o.retry;
    const at = e.at.getTime();
    switch (e.kind) {
      case "DEATH": {
        if (!sw.deaths || !e.actor || !(await this.d.store.member(e.actor))) return true;
        const base = deathText(e);
        const run = this.deaths.get(e.actor);
        if (run && at - run.lastAt < RUN_MS) {
          run.count++;
          run.lastAt = at;
          if (run.count >= 3 && run.messageId) {
            const r = await this.edit("feed", "deaths", run.messageId, asPlayer(brand, name, e.actor, deathRun(run.base, run.count - 2)));
            if (r.ok) await this.d.store.savePost({ key: `deaths:${e.actor}`, channel: "feed", messageId: run.messageId, postedAt: new Date(at), editedAt: now });
            return ok(r);
          }
          const r = await this.send(e, 0, "feed", "death", asPlayer(brand, name, e.actor, base));
          if (r.ok && r.id) {
            [run.messageId, run.base] = [r.id, base];
            await this.d.store.savePost({ key: `deaths:${e.actor}`, channel: "feed", messageId: r.id, postedAt: now, editedAt: null });
          }
          return ok(r);
        }
        this.deaths.set(e.actor, { count: 1, lastAt: at, messageId: "", base });
        return ok(await this.send(e, 0, "feed", "death", asPlayer(brand, name, e.actor, base)));
      }
      case "JOIN": {
        if (!e.actor || meta.inferred) return true;
        this.lastJoin.set(e.actor, at);
        // back within 2 minutes of leaving (a crash, a relog): neither the leave nor this join is posted
        if (this.pendingLeaves.delete(e.actor) || meta.rejoin) return true;
        if (!sw.joins || !(await this.d.store.member(e.actor))) return true;
        return ok(await this.send(e, 0, "feed", "join", asPlayer(brand, name, e.actor, joinText(await this.d.store.online()))));
      }
      case "LEAVE": {
        if (!e.actor || meta.inferred || !sw.joins) return true;
        const joined = this.lastJoin.get(e.actor);
        const short = joined !== undefined ? at - joined < SHORT_MS : typeof meta.minutes === "number" && meta.minutes < 2;
        if (short || !(await this.d.store.member(e.actor))) return true;
        // posted once two minutes have gone by without them coming back
        this.pendingLeaves.set(e.actor, { name, at, due: at + SHORT_MS });
        return true;
      }
      case "ADVANCEMENT": {
        const how = String(meta.how ?? "");
        if (!(how === "challenge" ? sw.challenges || sw.advancements : sw.advancements)) return true;
        if (!e.actor || !(await this.d.store.member(e.actor))) return true;
        return ok(await this.send(e, 0, "feed", "advancement", asPlayer(brand, name, e.actor, advancementText(how, String(meta.title ?? "")))));
      }
      case "SERVER_START": {
        if (!sw.serverUpDown || this.downPostedAt === null || now.getTime() - this.downPostedAt > BACK_MS) return true;
        this.downPostedAt = null;
        return ok(await this.send(e, 0, "feed", "server back", asServer(brand, backText())));
      }
      case "CRASH": {
        if (!sw.problems) return true;
        const adminTold = this.usable("admin") !== null;
        const a = adminTold ? await this.send(e, 0, "admin", "crash", asServer(brand, crashAdminText(e.at, this.d.portal))) : ({ ok: true, id: "" } as Outcome);
        if (!ok(a)) return false;
        return ok(await this.send(e, 1, "feed", "crash", asServer(brand, crashFeedText(adminTold && a.ok))));
      }
      case "ERROR": {
        if (!sw.problems || !this.usable("admin")) return true;
        const t = now.getTime();
        const seen = this.problems.get(e.message);
        this.problemTimes = this.problemTimes.filter((x) => t - x < 60 * 60_000);
        if ((seen !== undefined && t - seen < PROBLEM_REPEAT_MS) || this.problemTimes.length >= PROBLEMS_PER_HOUR) return true;
        const r = await this.send(e, 0, "admin", "problem", asServer(brand, problemText(e.message, 1)));
        if (r.ok) {
          this.problems.set(e.message, t);
          this.problemTimes.push(t);
        }
        return ok(r);
      }
      case "LINK": {
        if (actionOf(e) !== "link.bind" || resultOf(e) !== "OK" || !sw.firstJoin || !e.actor) return true;
        const mc = String(paramsOf(e).mcUsername ?? "");
        const key = `welcome:${e.actor}`;
        if (!mc || (await this.d.store.post(key))) return true; // once per member
        const r = await this.send(e, 0, "feed", "welcome", asServer(brand, welcomeText(mc)));
        if (r.ok) await this.d.store.savePost({ key, channel: "feed", messageId: r.id, postedAt: now, editedAt: null });
        return ok(r);
      }
      case "SYNC": {
        if (actionOf(e) !== "modpack.sync" || resultOf(e) !== "OK") return true;
        const change = await this.d.store.packChange();
        if (!change || !change.previous || change.previous === change.version || change.changed <= 0 || Math.abs(change.at.getTime() - at) > 15 * 60_000) return true;
        if (sw.serverUpDown) {
          const r = await this.send(e, 0, "feed", "restart", asServer(brand, restartText(true)));
          if (!ok(r)) return false;
          if (r.ok) this.downPostedAt = now.getTime();
        }
        return sw.pack ? ok(await this.send(e, 1, "feed", "pack", asServer(brand, packText(change.changed)))) : true;
      }
      case "ADMIN_ACTION":
      case "PLAYER_ACTION":
        return this.action(e, sw, brand, now);
      default:
        return true;
    }
  }

  private async action(e: FeedEvent, sw: Switches, brand: Brand, now: Date): Promise<boolean> {
    const action = actionOf(e);
    const p = paramsOf(e);
    const ok = (o: Outcome) => o.ok || !o.retry;
    if (resultOf(e) !== "OK" || !action) return true;
    switch (action) {
      case "server.restart":
      case "server.stop": {
        if (!sw.serverUpDown) return true;
        const r = await this.send(e, 0, "feed", action === "server.stop" ? "server off" : "restart", asServer(brand, action === "server.stop" ? stopText() : restartText(false)));
        if (r.ok) this.downPostedAt = now.getTime();
        return ok(r);
      }
      case "announcement.create": {
        if (!sw.news || typeof p.announcementId !== "string") return true;
        const item = await this.d.store.news(p.announcementId);
        if (!item) return true;
        const pic = item.image ? await this.d.store.picture(item.image) : null;
        return ok(await this.send(e, 0, "feed", "news", newsMessage(brand, item.body, pic?.name ?? null), pic ?? undefined));
      }
      case "site.settings": {
        if (!sw.live || p.live !== true || p.was !== false) return true;
        return ok(await this.send(e, 0, "feed", "live", asServer(brand, liveText(brand.name, new URL(this.d.portal).host))));
      }
      case "poll.open":
      case "vote.open":
        return this.voteOpened(e, action === "poll.open" ? "poll" : "ballot", String(p.pollId ?? p.voteId ?? ""), sw, brand, now);
      case "poll.vote":
      case "ballot.save": {
        const id = String(p.pollId ?? p.voteId ?? "");
        if (sw.votes && id) this.dirtyVotes.add(`${action === "poll.vote" ? "poll" : "ballot"}:${id}`);
        return true;
      }
      case "poll.close":
      case "vote.close":
        return this.voteClosed(e, action === "poll.close" ? "poll" : "ballot", String(p.pollId ?? p.voteId ?? ""), sw, brand, now);
      default:
        return true;
    }
  }

  // ---- §5: votes ----------------------------------------------------------------------------------------------------

  private async voteOpened(e: FeedEvent, kind: PollView["kind"], id: string, sw: Switches, brand: Brand, now: Date): Promise<boolean> {
    if (!sw.votes || !id) return true;
    const key = `${kind}:${id}`;
    if (await this.d.store.post(key)) return true;
    const v = await this.d.store.vote(kind, id);
    if (!v || v.status !== "OPEN") return true; // closed or deleted since: nothing
    const r = await this.send(e, 0, "feed", `${kind} opened`, voteMessage(brand, v, this.d.portal));
    if (r.ok) await this.d.store.savePost({ key, channel: "feed", messageId: r.id, postedAt: now, editedAt: null });
    return r.ok || !r.retry;
  }

  private async voteClosed(e: FeedEvent, kind: PollView["kind"], id: string, sw: Switches, brand: Brand, now: Date): Promise<boolean> {
    if (!sw.votes || !id) return true;
    const v = await this.d.store.vote(kind, id);
    if (!v) return true;
    const key = `${kind}:${id}`;
    this.dirtyVotes.delete(key);
    const post = await this.d.store.post(key);
    if (post?.messageId && !(this.partial?.id === e.id && this.partial.done.has(0))) {
      const r = await this.edit("feed", `${kind} result`, post.messageId, voteMessage(brand, v, this.d.portal));
      if (r.ok) await this.d.store.savePost({ ...post, editedAt: now });
      if (!r.ok && r.retry) return false;
      if (this.partial?.id !== e.id) this.partial = { id: e.id, done: new Set() };
      this.partial.done.add(0);
    }
    const r = await this.send(e, 1, "feed", `${kind} closed`, asServer(brand, voteClosedText(v, this.d.portal)));
    return r.ok || !r.retry;
  }

  // ---- what happens with time, not with an event ---------------------------------------------------------------------

  private async duties(sw: Switches) {
    const now = this.now();
    const t = now.getTime();
    const brand = await this.d.store.brand();
    // leaves that nobody came back from
    for (const [uuid, l] of [...this.pendingLeaves]) {
      if (l.due > t) continue;
      this.pendingLeaves.delete(uuid);
      if (t - l.at > SHORT_MS + 10 * 60_000) continue; // stale: api was busy or away
      const r = await this.send(null, 0, "feed", "leave", asPlayer(brand, l.name, uuid, leaveText(await this.d.store.online())));
      if (!r.ok && r.retry) this.pendingLeaves.set(uuid, l);
    }
    for (const [uuid, run] of [...this.deaths]) if (t - run.lastAt >= RUN_MS) this.deaths.delete(uuid);
    for (const [uuid, at] of [...this.lastJoin]) if (t - at > 24 * 60 * 60_000) this.lastJoin.delete(uuid);
    if (!sw.votes) return;
    // a vote's count, at most once a minute
    for (const key of [...this.dirtyVotes]) {
      const post = await this.d.store.post(key);
      if (!post?.messageId) {
        this.dirtyVotes.delete(key);
        continue;
      }
      if (t - (post.editedAt ?? post.postedAt).getTime() < EDIT_GAP_MS) continue;
      const [kind, id] = key.split(":") as [PollView["kind"], string];
      const v = await this.d.store.vote(kind, id);
      this.dirtyVotes.delete(key);
      if (!v || v.status !== "OPEN") continue; // the close edits it
      const r = await this.edit("feed", `${kind} count`, post.messageId, voteMessage(brand, v, this.d.portal));
      if (r.ok) await this.d.store.savePost({ ...post, editedAt: now });
      else if (r.retry) this.dirtyVotes.add(key);
    }
    // the reminder 24 hours before a vote closes
    if (t - this.remindedAt < 60_000) return;
    this.remindedAt = t;
    for (const v of await this.d.store.remindable(now)) {
      const key = `remind:${v.kind}:${v.id}`;
      if (await this.d.store.post(key)) continue;
      const missing = await this.d.store.unvoted(v.kind, v.id);
      if (missing.discordIds.length + missing.others === 0) {
        await this.d.store.savePost({ key, channel: "feed", messageId: "", postedAt: now, editedAt: null }); // everybody has
        continue;
      }
      const r = await this.send(null, 0, "feed", "reminder", reminderMessage(brand, v, missing, sw.mentionUnvoted, now));
      if (r.ok || !r.retry) await this.d.store.savePost({ key, channel: "feed", messageId: r.ok ? r.id : "", postedAt: now, editedAt: null });
    }
  }
}
