import { randomInt } from "node:crypto";
import type { Amp } from "../amp/client.js";
import type { ConsoleTail, ConsoleEvent, EventInfo } from "../amp/console.js";
import { db } from "../db.js";
import { audit } from "../audit.js";
import type { Env } from "../env.js";
import { runAction } from "../actions/run.js";
import { parsePlace, parsePos, type ActionCtx } from "../actions/registry.js";
import { getSection } from "../settings.js";
import { PLAY_MODES, playGate, type BlockReason, type PlayRun } from "../shared/join-gate.js";
import { serverPack } from "./pack.js";
import { modsMissingFor } from "./mods.js";
import { unvotedFor } from "./polls.js";
import { doorRule, type Member } from "../shared/access.js";
import { CODE_TTL_MS, makeCode } from "../shared/join-code.js";
import { prismaHeldStore, type HeldRow, type HeldStore } from "./held-store.js";

// docs/14: the white room. Unlinked joins are held in the room with a clickable link; linking releases them.

const codeGen = () => makeCode(randomInt);
/** The prompt (chat line, title, subtitle, action bar) again every 15 s: the chat fades after 10 s. */
export const PROMPT_EVERY_MS = 15_000;
/** The action bar fades after about 3 s: it is sent again with every round of the room, unless the prompt just went. */
const BAR_GAP_MS = 4_000;
const IDLE_KICK_MS = 15 * 60_000;
const GUILD_REFRESH_MS = 5 * 60_000;
const SAME_JOIN_MS = 15_000; // "logged in with entity id" and "joined the game" are two lines for one join

/** Where a member stood when they joined, so that they can be put back there. */
export type Back = { dimension: string; x: number; y: number; z: number };
/** `kind`: waiting to link their Discord, or (docs/14 "Play first") a member who has not pressed Play. */
/** "closed": a member for whom the server is not open yet (not live, no early access; docs/13 §9). */
/** `lastReminder`: when the prompt last went to them (docs/14 "The prompt"). */
/** "old": their last run was from an installer below Settings → Joining "Minimum installer version". */
/** `reason`: the door's word for it, as it is kept in HeldPlayer (docs/31 B-02). */
export type Held = { uuid: string; code: string; since: number; lastReminder: number; kind: "link" | HeldFor; userId?: string; back?: Back | null; reason?: string };
/** "vote": an open must-vote poll they have not answered (planner 2026-10-02). */
type HeldFor = "play" | "closed" | "old" | "mods" | "vote";
/** Which wait a reason at the door is. */
export const waitFor = (reason: BlockReason): HeldFor => (reason === "not live" ? "closed" : reason === "vote" ? "vote" : reason === "old installer" ? "old" : reason === "missing mods" ? "mods" : "play");
const HOLD = { play: "limbo.holdPlay", closed: "limbo.holdClosed", old: "limbo.holdOld", mods: "limbo.holdMods", vote: "limbo.holdVote" } as const;
const REMIND = { play: "limbo.remindPlay", closed: "limbo.remindClosed", old: "limbo.remindOld", mods: "limbo.remindMods", vote: "limbo.remindVote" } as const;
const KICK = { link: "limbo.kickIdle", play: "limbo.kickIdlePlay", closed: "limbo.kickIdleClosed", old: "limbo.kickIdleOld", mods: "limbo.kickIdleMods", vote: "limbo.kickIdleVote" } as const;
/** What a wait was, in the event log's words ("join.ready" `was`). */
const WAS: Record<HeldFor, string> = { closed: "not live", old: "old installer", mods: "missing mods", vote: "vote", play: "play" };
/** The reasons someone who has to link is held for (`decideJoin`); every other reason in HeldPlayer is the door's. */
const LINK_REASONS = new Set(["unknown uuid", "not linked", "left the discord server"]);
type Known = Member & { id: string };

export type JoinDecision = { action: "release" | "hold"; reason: string };

const WHERE_WAIT_MS = 6000; // the console is read every two seconds
const WHERE_FRESH_MS = 20_000;

/** Pure: what to do with a join, given what the portal knows about that UUID. */
export function decideJoin(user: { verifiedAt: Date | null; guildMember: boolean } | null): JoinDecision {
  if (!user) return { action: "hold", reason: "unknown uuid" };
  if (!user.verifiedAt) return { action: "hold", reason: "not linked" };
  if (!user.guildMember) return { action: "hold", reason: "left the discord server" };
  return { action: "release", reason: "linked member" };
}

/**
 * Pure: the door for a linked member, in its order. Open for them (admin, live, early access)? Then the must-vote
 * polls: `unvoted` is how many open ones they have not answered (planner 2026-10-02; admins are never held for it).
 * Then Play first: `run` is their latest run of Play or of the installer that went through. Null: in. Joining and
 * having just linked in the room both come through here (2026-09-29: a member who linked was let in without Play first).
 */
export function doorReason(user: Member, d: { live: boolean; requirePlay: boolean; windowMin: number; run: PlayRun | null; pack: string | null; now: Date; minInstaller?: string; modsMissing?: boolean; unvoted?: number }): BlockReason | null {
  const door = doorRule(user, { live: d.live, requirePlay: d.requirePlay, hasPlayed: true, unvoted: d.unvoted });
  if (door === "not open") return "not live";
  if (door === "vote first") return "vote";
  if (doorRule(user, { live: d.live, requirePlay: d.requirePlay, hasPlayed: false }) === "in") return null; // Play is not asked of them
  const gate = playGate(d.run, d.pack, d.windowMin, d.now, d.minInstaller ?? "", d.modsMissing ?? false);
  return gate.ok ? null : gate.reason;
}

export class Limbo {
  readonly held = new Map<string, Held>(); // by player name
  private readonly lastJoin = new Map<string, number>();
  private readonly lastPos = new Map<string, { x: number; y: number; z: number; at: number }>();
  private readonly lastDim = new Map<string, { dimension: string; at: number }>();
  private ctx: ActionCtx;
  private timers: NodeJS.Timeout[] = [];
  /** Old lines have been read; the room is put right when the server's live answer to `list` arrives. */
  private resyncDue = false;
  private readonly store: HeldStore;

  constructor(private readonly env: Env, private readonly amp: Amp, private readonly tail: ConsoleTail, private readonly log: (o: unknown, m: string) => void, store?: HeldStore) {
    this.store = store ?? prismaHeldStore(log);
    this.ctx = { limbo: parsePlace(env.LIMBO_POS), spawn: env.SPAWN_POS ? parsePos(env.SPAWN_POS) : null, portalUrl: env.PORTAL_URL };
  }

  get actionCtx() {
    return this.ctx;
  }

  start() {
    this.tail.on((e, info) => void this.onEvent(e, info).catch((err) => this.log({ err: String(err) }, "limbo event failed")));
    // docs/31 B-03: nothing is done on the old lines themselves. They only say that the room has to be looked at;
    // the look happens on the server's live answer to `list`, which the online watch asks for at every resync.
    this.tail.onResync(() => { this.resyncDue = true; });
    this.timers.push(setInterval(() => void this.tick().catch((err) => this.log({ err: String(err) }, "limbo tick failed")), 5000));
    this.timers.push(setInterval(() => void this.promptRound().catch((err) => this.log({ err: String(err) }, "limbo prompt failed")), 1000));
    // Admin → Branding's name and tagline for the room's sign and the welcome line, kept fresh once a minute
    const brand = () => void getSection("branding").then((b) => Object.assign(this.ctx, { siteName: b.name, tagline: b.tagline })).catch(() => undefined);
    brand();
    this.timers.push(setInterval(brand, 60_000));
    this.timers.push(setInterval(() => void this.refreshGuild().catch((err) => this.log({ err: String(err) }, "guild refresh failed")), GUILD_REFRESH_MS));
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
  }

  async onEvent(e: ConsoleEvent, info: EventInfo = { replay: false }) {
    // A join read from old lines is not a join: nobody is moved or greeted because of it (see `resync`).
    if (e.type === "join" && !info.replay) {
      const now = Date.now();
      const last = this.lastJoin.get(e.name) ?? 0;
      this.lastJoin.set(e.name, now);
      if (now - last >= SAME_JOIN_MS) await this.onJoin(e.name);
    }
    if (e.type === "pos" && !info.replay) this.lastPos.set(e.name, { x: e.x, y: e.y, z: e.z, at: Date.now() });
    if (e.type === "dimension" && !info.replay) this.lastDim.set(e.name, { dimension: e.dimension, at: Date.now() });
    // Somebody in the room who says anything has probably not seen the link: it goes again at once, and the 15 s start over.
    if (e.type === "chat" && !info.replay) {
      const h = this.held.get(e.name);
      if (h) await this.prompt(e.name, h, Date.now());
    }
    if (e.type === "refused" && !info.replay) await this.onRefused(e);
    if (e.type === "leave") {
      // What is kept in HeldPlayer stays: it is what puts a member back where they stood when they come again
      // (docs/31 B-02). Only someone who was to link and has no place to go back to leaves nothing worth keeping.
      const h = this.held.get(e.name);
      if (h?.kind === "link" && h.uuid && !h.back) await this.store.remove(h.uuid);
      this.held.delete(e.name);
      this.lastJoin.delete(e.name);
      this.lastPos.delete(e.name);
      this.lastDim.delete(e.name);
    }
    if (e.type === "list") {
      for (const name of [...this.held.keys()]) if (!e.names.includes(name)) this.held.delete(name);
      if (!info.replay && this.resyncDue) {
        this.resyncDue = false;
        await this.resync(e.names);
      }
    }
  }

  /**
   * After old lines have been read (api restarted, or AMP gave out a new session), on the server's live answer to
   * `list` (`names`): whoever was being held is held again, with what HeldPlayer kept; whoever is online, should be
   * in the room and is not, is held. Members are left exactly where they are.
   *
   * docs/31 B-03, B-04. A name with no UUID in memory is looked up among the members by its name; a name nobody
   * knows is left alone and said so in the log. It used to be held "by name only", with a code that did not exist,
   * and after a restart that was every member who was playing.
   */
  async resync(names: readonly string[] = [...this.tail.online]) {
    for (const name of names) {
      if (this.held.has(name)) continue;
      let uuid = this.tail.uuidByName.get(name) ?? null;
      const select = { id: true, verifiedAt: true, guildMember: true, mcUuid: true } as const;
      const user = uuid ? await db.user.findFirst({ where: { mcUuid: uuid }, select }) : await db.user.findFirst({ where: { mcUsername: name }, select });
      if (!uuid && user?.mcUuid) uuid = user.mcUuid;
      const row = uuid ? await this.store.get(uuid) : await this.store.byName(name);
      if (row) {
        if (!uuid) uuid = row.mcUuid;
        this.tail.uuidByName.set(name, uuid);
        this.adopt(name, row, user && user.verifiedAt && user.guildMember ? user.id : undefined);
        this.log({ name, uuid, reason: row.reason, back: Boolean(row.back) }, "resync: was being held, held again");
        continue;
      }
      if (!uuid) {
        this.log({ name }, "resync: online, no UUID in memory and no member of that name: left alone");
        continue;
      }
      this.tail.uuidByName.set(name, uuid);
      const decision = decideJoin(user);
      this.log({ name, uuid, decision }, "resync");
      if (decision.action === "hold") await this.hold(name, uuid, decision.reason);
    }
  }

  /** Someone HeldPlayer says was in the room: in memory again as they were. They are not moved; the next round does the rest. */
  private adopt(name: string, row: HeldRow, memberId: string | undefined) {
    const kind = memberId && !LINK_REASONS.has(row.reason) ? waitFor(row.reason as BlockReason) : memberId ? "play" : "link";
    // `lastReminder: 0`: the prompt goes at once. For a link it also looks the code up again and hands out the book if it changed.
    this.held.set(name, { uuid: row.mcUuid, code: kind === "link" ? (row.codeId ?? "") : "", since: Date.now(), lastReminder: 0, kind, userId: memberId, back: row.back, reason: row.reason });
  }

  async onJoin(name: string) {
    // The first line on joining, for everyone: the server's name and tagline (planner, 2026-10-01)
    const brand = await getSection("branding").catch(() => null);
    if (brand) Object.assign(this.ctx, { siteName: brand.name, tagline: brand.tagline });
    void runAction(this.amp, this.ctx, "server.welcome", { name }, null).catch(() => undefined);
    // The UUID line precedes the login line; give it a moment if it hasn't arrived.
    let uuid = this.tail.uuidByName.get(name);
    for (let i = 0; !uuid && i < 5; i++) {
      await new Promise((r) => setTimeout(r, 400));
      uuid = this.tail.uuidByName.get(name);
    }
    const user = uuid ? await db.user.findFirst({ where: { mcUuid: uuid }, select: { id: true, verifiedAt: true, guildMember: true, mcUsername: true, role: true, earlyAccess: true } }) : null;
    const decision = decideJoin(user);
    this.log({ name, uuid, decision }, "join");
    if (decision.action === "release") {
      if (user && user.mcUsername !== name) await db.user.update({ where: { id: user.id }, data: { mcUsername: name } }); // name change
      // The door (`doorRule`, shared/access.ts): is the server open for them, live or early access? Then Play first.
      // Admins are never held.
      const blocked = user ? await this.atTheDoor(user) : null;
      if (blocked) {
        await this.holdMember(name, uuid ?? "", user!.id, blocked);
        return;
      }
      // docs/31 B-02: they were being held when they left, so they stand in the room without their tag. With a
      // place kept for them they go back to it; `link.release` would send them to spawn, and before that the room
      // itself was taken for where they stood and they were sealed in it.
      const kept = uuid ? await this.store.get(uuid) : null;
      if (kept?.back) {
        await this.releaseBack(name, { uuid: kept.mcUuid, code: "", since: Date.now(), lastReminder: Date.now(), kind: "play", userId: user?.id, back: kept.back, reason: kept.reason });
        return;
      }
      if (kept) await this.store.remove(kept.mcUuid);
      await runAction(this.amp, this.ctx, "link.release", { name }, null);
      return;
    }
    if (!uuid) {
      // docs/31 B-03: nobody is held by name alone. Without the UUID line there is no code to give them and no
      // way to tell a member from a stranger; the next `list` round or their next join sees them again.
      this.log({ name }, "join without uuid: not held");
      await audit({ action: "limbo.held", params: { name, uuid: null, reason: "no uuid" }, result: "FAILED", detail: "the server's UUID line for this join was not read; not held" });
      return;
    }
    await this.hold(name, uuid, decision.reason);
  }

  private liveSeen: { at: number; live: boolean } | null = null;

  /** "We're live" on the portal; asked again when the answer is ten seconds old. Not live when nothing says. */
  private async live(): Promise<boolean> {
    if (this.liveSeen && Date.now() - this.liveSeen.at < 10_000) return this.liveSeen.live;
    const live = (await db.siteSettings.findUnique({ where: { id: "site" }, select: { live: true } }).catch(() => null))?.live ?? false;
    this.liveSeen = { at: Date.now(), live };
    return live;
  }

  private readonly lastRefused = new Map<string, number>();

  /**
   * 2.1.0: NeoForge refused them at the handshake because their game lacks a mod the server needs. They never got in,
   * so the room cannot hold them; it is written down against their account, and from then on the site, the app and
   * the room say "Your game is missing some mods. Press Play on the site to fix it." until a Play goes through.
   */
  private async onRefused(e: Extract<ConsoleEvent, { type: "refused" }>) {
    const now = Date.now();
    if (now - (this.lastRefused.get(e.name) ?? 0) < SAME_JOIN_MS) return; // one line per attempt is enough
    this.lastRefused.set(e.name, now);
    const user = await db.user.findFirst({ where: e.uuid ? { OR: [{ mcUuid: e.uuid }, { mcUsername: e.name }] } : { mcUsername: e.name }, select: { id: true } });
    await audit({ userId: user?.id ?? null, action: "join.blocked", params: { name: e.name, uuid: e.uuid, reason: "missing mods", refused: true, mod: e.mod, channel: e.channel }, result: "DENIED", detail: e.reason.slice(0, 300) });
  }

  /** Why this member may not come in yet, or null when they may (`doorReason`). */
  protected async atTheDoor(user: Known): Promise<BlockReason | null> {
    const [live, joining, run, pack] = await Promise.all([
      this.live(),
      getSection("joining"),
      db.installReport.findFirst({ where: { userId: user.id, mode: { in: [...PLAY_MODES] }, outcome: "ok" }, orderBy: { at: "desc" }, select: { at: true, packVersion: true, installerVersion: true } }),
      serverPack(),
    ]);
    const [modsMissing, unvoted] = await Promise.all([modsMissingFor(user.id, run), user.role === "ADMIN" ? Promise.resolve(0) : unvotedFor(user.id)]);
    return doorReason(user, { live, requirePlay: joining.requirePlay, windowMin: joining.windowMin, run, pack, now: new Date(), minInstaller: joining.minInstaller, modsMissing, unvoted });
  }

  /** Asks the server where they are and waits for the answer; null when none comes. */
  protected async where(name: string): Promise<Back | null> {
    const asked = Date.now();
    const r = await runAction(this.amp, this.ctx, "player.where", { name }, null);
    if (!r.ok) return null;
    while (Date.now() - asked < WHERE_WAIT_MS) {
      const pos = this.lastPos.get(name);
      const dim = this.lastDim.get(name);
      if (pos && dim && pos.at >= asked - 500 && dim.at >= asked - 500) return { dimension: dim.dimension, x: pos.x, y: pos.y, z: pos.z };
      await new Promise((r2) => setTimeout(r2, 250));
    }
    const pos = this.lastPos.get(name);
    const dim = this.lastDim.get(name);
    return pos && dim && Date.now() - pos.at < WHERE_FRESH_MS && Date.now() - dim.at < WHERE_FRESH_MS ? { dimension: dim.dimension, x: pos.x, y: pos.y, z: pos.z } : null;
  }

  /** A linked member who may not come in yet. `inRoom`: they are in the room already (they have just linked). */
  protected async holdMember(name: string, uuid: string, userId: string, reason: BlockReason, inRoom = false) {
    const kept = uuid ? await this.store.get(uuid) : null;
    let back = inRoom ? null : await this.where(name); // before they are moved
    if (!this.tail.online.has(name)) return; // gone while we asked
    // The room is never a place to go back to (docs/31 B-02): they logged out while being held. What was kept
    // from the first hold stands; with nothing kept they go to spawn when the door opens.
    if (back && back.dimension === this.ctx.limbo.dimension) back = null;
    back = back ?? kept?.back ?? null;
    const kind = waitFor(reason);
    this.held.set(name, { uuid, code: "", since: Date.now(), lastReminder: Date.now(), kind, userId, back, reason });
    if (uuid) await this.store.put({ mcUuid: uuid, mcUsername: name, since: new Date(), reason, codeId: null, back });
    await runAction(this.amp, this.ctx, HOLD[kind], { name }, null);
    await audit({ userId, action: "join.blocked", params: { name, uuid, reason, back: Boolean(back) }, result: "OK" });
  }

  private async releaseBack(name: string, h: Held) {
    this.held.delete(name);
    const r = await runAction(this.amp, this.ctx, "limbo.releaseBack", { name, back: h.back ?? null }, null);
    if (r.ok && h.uuid) await this.store.remove(h.uuid); // kept when the command did not go through: the next join or round tries again
    await audit({ userId: h.userId ?? null, action: "join.ready", params: { name, uuid: h.uuid, back: Boolean(h.back), was: WAS[h.kind === "link" ? "play" : h.kind] }, result: r.ok ? "OK" : "FAILED", detail: r.detail ?? null });
  }

  private async hold(name: string, uuid: string, reason: string) {
    const brand = await getSection("branding");
    Object.assign(this.ctx, { siteName: brand.name, tagline: brand.tagline }); // Admin → Branding; read again for every newcomer
    const code = uuid ? await this.codeFor(uuid, name, true) : codeGen(); // a new code for every join
    const kept = uuid ? await this.store.get(uuid) : null; // a member who left the Discord server while held keeps their place
    this.held.set(name, { uuid, code, since: Date.now(), lastReminder: Date.now(), kind: "link", back: kept?.back ?? null, reason });
    if (uuid) await this.store.put({ mcUuid: uuid, mcUsername: name, since: new Date(), reason, codeId: code, back: kept?.back ?? null });
    await runAction(this.amp, this.ctx, "limbo.hold", { name, code }, null);
    await audit({ action: "limbo.held", params: { name, uuid, reason }, result: "OK" });
  }

  /**
   * One live code per UUID, 30 minutes long (docs/14 "The join code"). While they stay it is the same code, so the
   * link and the code on screen do not change under them; `fresh` (each join) ends the old one and makes another.
   */
  protected async codeFor(uuid: string, name: string, fresh = false, now = new Date()): Promise<string> {
    if (fresh) {
      await db.linkCode.updateMany({ where: { mcUuid: uuid, usedById: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
    } else {
      const existing = await db.linkCode.findFirst({ where: { mcUuid: uuid, usedById: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } });
      if (existing) return existing.code;
    }
    for (let i = 0; i < 5; i++) {
      const code = codeGen();
      if (await db.linkCode.findUnique({ where: { code } })) continue;
      await db.linkCode.create({ data: { code, mcUuid: uuid, mcUsername: name, expiresAt: new Date(now.getTime() + CODE_TTL_MS) } });
      return code;
    }
    throw new Error("could not allocate a link code");
  }

  private prompting = false;

  /** Every second: the prompt to whoever has not had it for 15 s. */
  async promptRound(now = Date.now()) {
    if (this.held.size === 0 || this.tail.state !== 20 || this.prompting) return;
    this.prompting = true; // a slow AMP must not have two rounds send the same prompt twice
    try {
      for (const [name, h] of [...this.held]) if (this.held.get(name) === h && now - h.lastReminder >= PROMPT_EVERY_MS) await this.prompt(name, h, now);
    } finally {
      this.prompting = false;
    }
  }

  /** The chat line, and the title, subtitle and action bar, for what they wait for. */
  protected async prompt(name: string, h: Held, now: number) {
    h.lastReminder = now;
    if (h.kind === "link") {
      const was = h.code;
      if (h.uuid) h.code = await this.codeFor(h.uuid, name); // the same code, or a new one if it ran out meanwhile
      if (this.held.get(name) !== h) return; // let in, or gone, while the code was looked up
      if (h.code !== was) await runAction(this.amp, this.ctx, "limbo.giveBook", { name, code: h.code }, null); // the old book's code is dead
      await runAction(this.amp, this.ctx, "limbo.remind", { name, code: h.code }, null);
    } else {
      await runAction(this.amp, this.ctx, REMIND[h.kind], { name }, null);
    }
  }

  /** Every 5 s while anyone is held: drag them back, open the door when it may, the action bar, kick the idle. (The prompt has a timer of its own.) */
  private async tick() {
    if (this.held.size === 0 || this.tail.state !== 20) return;
    await runAction(this.amp, this.ctx, "limbo.keep", {}, null);
    const now = Date.now();
    for (const [name, h] of this.held) {
      if (now - h.since > IDLE_KICK_MS) {
        await runAction(this.amp, this.ctx, KICK[h.kind], { name }, null);
        this.held.delete(name); // HeldPlayer keeps them: they come back to the room, and later to where they stood
        continue;
      }
      if (h.kind !== "link") {
        // The site may have gone live, the flag may have been given, they may have voted or pressed Play: looked at
        // every round, so that the door opens within seconds.
        const user = h.userId ? await db.user.findUnique({ where: { id: h.userId }, select: { id: true, role: true, earlyAccess: true } }) : null;
        const blocked = user ? await this.atTheDoor(user) : null;
        if (user && blocked === null) {
          await this.releaseBack(name, h);
          continue;
        }
        const kind = blocked ? waitFor(blocked) : h.kind;
        if (user && blocked && kind !== h.kind) {
          // open for them now, but Play first has not been met (or the other way round): the other words, at once
          h.kind = kind;
          await this.prompt(name, h, now);
          continue;
        }
      }
      if (h.kind === "link" && h.code) await runAction(this.amp, this.ctx, "limbo.bookCheck", { name, code: h.code }, null); // dropped: another within 5 s
      if (now - h.lastReminder >= BAR_GAP_MS) await runAction(this.amp, this.ctx, "limbo.bar", h.kind === "link" ? { name, kind: h.kind, code: h.code } : { name, kind: h.kind }, null);
    }
  }

  /** Called by the portal after a successful link. Releases now if online, otherwise the next join does it. */
  async release(uuid: string): Promise<{ released: boolean; name?: string }> {
    const name = [...this.tail.uuidByName.entries()].find(([, u]) => u === uuid)?.[0];
    if (!name || !this.tail.online.has(name)) return { released: false };
    const was = this.held.get(name);
    if (was && was.kind !== "link") return { released: false }; // linked long ago; they wait for something else
    // They have just linked: the door as for anybody who walks in (`doorReason`), open for them and then Play
    // first. Held, they stay in the room with that line (not open yet, or press Play) instead of the link line.
    const user = await this.memberByUuid(uuid);
    const blocked = user ? await this.atTheDoor(user) : null;
    if (user && blocked) {
      await this.holdMember(name, uuid, user.id, blocked, true);
      return { released: false, name };
    }
    if (was?.back) {
      // linked again after leaving the Discord server while a place was kept for them: back to it, not to spawn
      await this.releaseBack(name, { ...was, userId: user?.id });
      return { released: true, name };
    }
    this.held.delete(name);
    const r = await this.letIn(name);
    if (r.ok) await this.store.remove(uuid);
    return { released: r.ok, name };
  }

  /** Who is in the room and why, for Admin → Control Room (docs/32 §7 item 10). */
  heldList(): Array<{ name: string; uuid: string | null; kind: Held["kind"]; reason: string | null; since: string; member: boolean; back: boolean }> {
    return [...this.held.entries()].map(([name, h]) => ({ name, uuid: h.uuid || null, kind: h.kind, reason: h.reason ?? null, since: new Date(h.since).toISOString(), member: Boolean(h.userId), back: Boolean(h.back) }));
  }

  /**
   * An admin lets a held member in whatever the door says (Play first, the vote, not live). Only a linked member:
   * someone who has to link is not let in by a button, they link. Audited with the admin's id.
   */
  async adminRelease(name: string, adminId: string | null): Promise<{ ok: boolean; code?: "not_held" | "not_linked" | "failed" }> {
    const h = this.held.get(name);
    if (!h) return { ok: false, code: "not_held" };
    if (h.kind === "link" || !h.userId) {
      await audit({ userId: adminId, action: "limbo.adminRelease", params: { name, uuid: h.uuid, refused: "not linked" }, result: "DENIED" });
      return { ok: false, code: "not_linked" };
    }
    this.held.delete(name);
    const r = await runAction(this.amp, this.ctx, "limbo.releaseBack", { name, back: h.back ?? null }, null);
    if (r.ok && h.uuid) await this.store.remove(h.uuid);
    if (!r.ok) this.held.set(name, h);
    await audit({ userId: adminId, action: "limbo.adminRelease", params: { name, uuid: h.uuid, was: h.reason ?? WAS[h.kind], back: Boolean(h.back) }, result: r.ok ? "OK" : "FAILED", detail: r.detail ?? null });
    return r.ok ? { ok: true } : { ok: false, code: "failed" };
  }

  protected memberByUuid(uuid: string): Promise<Known | null> {
    return db.user.findFirst({ where: { mcUuid: uuid }, select: { id: true, role: true, earlyAccess: true } });
  }

  protected letIn(name: string) {
    return runAction(this.amp, this.ctx, "link.release", { name }, null);
  }

  /** Member left the Discord server (or admin removed them): back to the room next join; kicked now if online. */
  async revoke(uuid: string, callerId: string | null, reason?: string): Promise<{ kicked: boolean; name?: string }> {
    const name = [...this.tail.uuidByName.entries()].find(([, u]) => u === uuid)?.[0];
    if (!name || !this.tail.online.has(name)) return { kicked: false };
    const r = await runAction(this.amp, this.ctx, "player.revoke", reason ? { name, reason } : { name }, callerId);
    return { kicked: r.ok, name };
  }

  /**
   * docs/22 §7: the gateway says a member left (or came back to) the Discord server. Checked at once, the same way the
   * five-minute check does it: the flag, and someone playing is taken out as by docs/14.
   */
  async memberChanged(discordId: string, inGuild: boolean) {
    const u = await db.user.findUnique({ where: { discordId }, select: { id: true, mcUuid: true, guildMember: true } });
    if (!u) return;
    if (u.guildMember !== inGuild) await this.setGuildMember(u.id, inGuild);
    if (!inGuild && u.mcUuid) await this.revoke(u.mcUuid, null);
  }

  /**
   * The Discord server flag. docs/31 B-05: when it goes false, every portal session they have ends
   * (`sessionVersion`) and the installer's tokens are refused, so an old cookie cannot link them back in.
   */
  private async setGuildMember(userId: string, member: boolean) {
    await db.user.update({ where: { id: userId }, data: member ? { guildMember: true } : { guildMember: false, sessionVersion: { increment: 1 } } });
    if (!member) await db.launcherAuth.updateMany({ where: { userId, status: "approved" }, data: { status: "denied" } }).catch((err) => this.log({ err: String(err) }, "could not end the installer's tokens"));
  }

  /** With a bot token: re-check guild membership of online, linked players every 5 min. Without one: rely on login-time checks. */
  private async refreshGuild() {
    if (!this.env.DISCORD_BOT_TOKEN || !this.env.DISCORD_GUILD_ID || this.tail.state !== 20 || this.tail.online.size === 0) return;
    const uuids = [...this.tail.online].map((n) => this.tail.uuidByName.get(n)).filter((u): u is string => Boolean(u));
    const users = await db.user.findMany({ where: { mcUuid: { in: uuids }, discordId: { not: null } }, select: { id: true, discordId: true, mcUuid: true, guildMember: true } });
    for (const u of users) {
      const res = await fetch(`https://discord.com/api/v10/guilds/${this.env.DISCORD_GUILD_ID}/members/${u.discordId}`, { headers: { authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` }, signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (!res) continue;
      const member = res.status === 200;
      if (res.status !== 200 && res.status !== 404) continue; // rate limit or outage: leave as is
      if (member !== u.guildMember) await this.setGuildMember(u.id, member);
      if (!member && u.mcUuid) await this.revoke(u.mcUuid, null);
    }
  }
}
