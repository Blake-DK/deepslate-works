import { randomInt } from "node:crypto";
import type { Amp } from "../amp/client.js";
import type { ConsoleTail, ConsoleEvent, EventInfo } from "../amp/console.js";
import { db } from "../db.js";
import { audit } from "../audit.js";
import type { Env } from "../env.js";
import { runAction } from "../actions/run.js";
import { parsePos, type ActionCtx } from "../actions/registry.js";
import { getSection } from "../settings.js";
import { playGate, type GateReason } from "../shared/join-gate.js";
import { serverPack } from "./pack.js";

// docs/14: the white room. Unlinked joins are held in the room with a clickable link; linking releases them.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const codeGen = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const CODE_TTL_MS = 15 * 60_000;
const REMIND_MS = 60_000;
const IDLE_KICK_MS = 15 * 60_000;
const GUILD_REFRESH_MS = 5 * 60_000;
const SAME_JOIN_MS = 15_000; // "logged in with entity id" and "joined the game" are two lines for one join

/** Where a member stood when they joined, so that they can be put back there. */
export type Back = { dimension: string; x: number; y: number; z: number };
/** `kind`: waiting to link their Discord, or (docs/14 "Play first") a member who has not pressed Play. */
type Held = { uuid: string; code: string; since: number; lastReminder: number; kind: "link" | "play"; userId?: string; back?: Back | null };

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

export class Limbo {
  readonly held = new Map<string, Held>(); // by player name
  private readonly lastJoin = new Map<string, number>();
  private readonly lastPos = new Map<string, { x: number; y: number; z: number; at: number }>();
  private readonly lastDim = new Map<string, { dimension: string; at: number }>();
  private ctx: ActionCtx;
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly env: Env, private readonly amp: Amp, private readonly tail: ConsoleTail, private readonly log: (o: unknown, m: string) => void) {
    this.ctx = { limbo: parsePos(env.LIMBO_POS), spawn: env.SPAWN_POS ? parsePos(env.SPAWN_POS) : null, portalUrl: env.PORTAL_URL };
  }

  get actionCtx() {
    return this.ctx;
  }

  start() {
    this.tail.on((e, info) => void this.onEvent(e, info).catch((err) => this.log({ err: String(err) }, "limbo event failed")));
    this.tail.onResync(() => void this.resync().catch((err) => this.log({ err: String(err) }, "limbo resync failed")));
    this.timers.push(setInterval(() => void this.tick().catch((err) => this.log({ err: String(err) }, "limbo tick failed")), 5000));
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
    if (e.type === "leave") {
      this.held.delete(e.name);
      this.lastJoin.delete(e.name);
      this.lastPos.delete(e.name);
      this.lastDim.delete(e.name);
    }
    if (e.type === "list") for (const name of [...this.held.keys()]) if (!e.names.includes(name)) this.held.delete(name);
  }

  /**
   * After old lines have been read (api restarted, or AMP gave out a new session): whoever is online and should be
   * in the room but is not held is held. Members are left exactly where they are.
   */
  async resync() {
    for (const name of this.tail.online) {
      if (this.held.has(name)) continue;
      const uuid = this.tail.uuidByName.get(name);
      const user = uuid ? await db.user.findFirst({ where: { mcUuid: uuid }, select: { verifiedAt: true, guildMember: true } }) : null;
      const decision = decideJoin(user);
      this.log({ name, uuid, decision }, "resync");
      if (decision.action === "hold") await this.hold(name, uuid ?? "", decision.reason);
    }
  }

  async onJoin(name: string) {
    // The UUID line precedes the login line; give it a moment if it hasn't arrived.
    let uuid = this.tail.uuidByName.get(name);
    for (let i = 0; !uuid && i < 5; i++) {
      await new Promise((r) => setTimeout(r, 400));
      uuid = this.tail.uuidByName.get(name);
    }
    if (!uuid) {
      this.log({ name }, "join without uuid: holding by name only");
    }
    const user = uuid ? await db.user.findFirst({ where: { mcUuid: uuid }, select: { id: true, verifiedAt: true, guildMember: true, mcUsername: true, role: true } }) : null;
    const decision = decideJoin(user);
    this.log({ name, uuid, decision }, "join");
    if (decision.action === "release") {
      if (user && user.mcUsername !== name) await db.user.update({ where: { id: user.id }, data: { mcUsername: name } }); // name change
      // docs/14 "Play first". Admins are never held.
      const blocked = user && user.role !== "ADMIN" ? await this.playFirst(user.id) : null;
      if (blocked) {
        await this.holdForPlay(name, uuid ?? "", user!.id, blocked);
        return;
      }
      await runAction(this.amp, this.ctx, "link.release", { name }, null);
      return;
    }
    await this.hold(name, uuid ?? "", decision.reason);
  }

  /** Why this member may not come in yet, or null when they may (or when Play is not asked for). */
  private async playFirst(userId: string): Promise<GateReason | null> {
    const joining = await getSection("joining");
    if (!joining.requirePlay) return null;
    const [run, pack] = await Promise.all([
      db.installReport.findFirst({ where: { userId, mode: "play", outcome: "ok" }, orderBy: { at: "desc" }, select: { at: true, packVersion: true } }),
      serverPack(),
    ]);
    const gate = playGate(run, pack, joining.windowMin, new Date());
    return gate.ok ? null : gate.reason;
  }

  /** Asks the server where they are and waits for the answer; null when none comes. */
  private async where(name: string): Promise<Back | null> {
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

  private async holdForPlay(name: string, uuid: string, userId: string, reason: GateReason) {
    const back = await this.where(name); // before they are moved
    if (!this.tail.online.has(name)) return; // gone while we asked
    this.held.set(name, { uuid, code: "", since: Date.now(), lastReminder: Date.now(), kind: "play", userId, back });
    await runAction(this.amp, this.ctx, "limbo.holdPlay", { name }, null);
    await audit({ userId, action: "join.blocked", params: { name, uuid, reason, back: Boolean(back) }, result: "OK" });
  }

  private async releaseBack(name: string, h: Held) {
    this.held.delete(name);
    const r = await runAction(this.amp, this.ctx, "limbo.releaseBack", { name, back: h.back ?? null }, null);
    await audit({ userId: h.userId ?? null, action: "join.ready", params: { name, uuid: h.uuid, back: Boolean(h.back) }, result: r.ok ? "OK" : "FAILED", detail: r.detail ?? null });
  }

  private async hold(name: string, uuid: string, reason: string) {
    this.ctx.siteName = (await getSection("branding")).name; // Admin → Branding; read again for every newcomer
    const code = uuid ? await this.codeFor(uuid, name) : codeGen();
    this.held.set(name, { uuid, code, since: Date.now(), lastReminder: Date.now(), kind: "link" });
    await runAction(this.amp, this.ctx, "limbo.hold", { name, code }, null);
    await audit({ action: "limbo.held", params: { name, uuid, reason }, result: "OK" });
  }

  /** One live code per UUID; reused while valid so the chat link stays the same. */
  private async codeFor(uuid: string, name: string): Promise<string> {
    const existing = await db.linkCode.findFirst({ where: { mcUuid: uuid, usedById: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    if (existing) return existing.code;
    for (let i = 0; i < 5; i++) {
      const code = codeGen();
      if (await db.linkCode.findUnique({ where: { code } })) continue;
      await db.linkCode.create({ data: { code, mcUuid: uuid, mcUsername: name, expiresAt: new Date(Date.now() + CODE_TTL_MS) } });
      return code;
    }
    throw new Error("could not allocate a link code");
  }

  /** Every 5 s while anyone is held: drag them back, remind them, kick the idle. */
  private async tick() {
    if (this.held.size === 0 || this.tail.state !== 20) return;
    await runAction(this.amp, this.ctx, "limbo.keep", {}, null);
    const now = Date.now();
    for (const [name, h] of this.held) {
      if (now - h.since > IDLE_KICK_MS) {
        await runAction(this.amp, this.ctx, h.kind === "play" ? "limbo.kickIdlePlay" : "limbo.kickIdle", { name }, null);
        this.held.delete(name);
        continue;
      }
      if (h.kind === "play") {
        // They may have pressed Play since: looked at every round, so that the door opens within seconds of the run.
        if (h.userId && (await this.playFirst(h.userId)) === null) {
          await this.releaseBack(name, h);
          continue;
        }
        if (now - h.lastReminder > REMIND_MS) {
          h.lastReminder = now;
          await runAction(this.amp, this.ctx, "limbo.remindPlay", { name }, null);
        }
        continue;
      }
      if (now - h.lastReminder > REMIND_MS) {
        // refresh the code if it expired meanwhile
        if (h.uuid) h.code = await this.codeFor(h.uuid, name);
        h.lastReminder = now;
        await runAction(this.amp, this.ctx, "limbo.remind", { name, code: h.code }, null);
      }
    }
  }

  /** Called by the portal after a successful link. Releases now if online, otherwise the next join does it. */
  async release(uuid: string): Promise<{ released: boolean; name?: string }> {
    const name = [...this.tail.uuidByName.entries()].find(([, u]) => u === uuid)?.[0];
    if (!name || !this.tail.online.has(name)) return { released: false };
    const was = this.held.get(name);
    if (was?.kind === "play") return { released: false }; // linked long ago; what they are waiting for is Play
    this.held.delete(name);
    const r = await runAction(this.amp, this.ctx, "link.release", { name }, null);
    return { released: r.ok, name };
  }

  /** Member left the Discord server (or admin removed them): back to the room next join; kicked now if online. */
  async revoke(uuid: string, callerId: string | null, reason?: string): Promise<{ kicked: boolean; name?: string }> {
    const name = [...this.tail.uuidByName.entries()].find(([, u]) => u === uuid)?.[0];
    if (!name || !this.tail.online.has(name)) return { kicked: false };
    const r = await runAction(this.amp, this.ctx, "player.revoke", reason ? { name, reason } : { name }, callerId);
    return { kicked: r.ok, name };
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
      if (member !== u.guildMember) await db.user.update({ where: { id: u.id }, data: { guildMember: member } });
      if (!member && u.mcUuid) await this.revoke(u.mcUuid, null);
    }
  }
}
