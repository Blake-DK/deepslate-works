import { randomInt } from "node:crypto";
import type { Amp } from "../amp/client.js";
import type { ConsoleTail, ConsoleEvent } from "../amp/console.js";
import { db } from "../db.js";
import { audit } from "../audit.js";
import type { Env } from "../env.js";
import { runAction } from "../actions/run.js";
import { parsePos, type ActionCtx } from "../actions/registry.js";

// docs/14: the white room. Unlinked joins are held in the room with a clickable link; linking releases them.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const codeGen = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const CODE_TTL_MS = 15 * 60_000;
const REMIND_MS = 60_000;
const IDLE_KICK_MS = 15 * 60_000;
const GUILD_REFRESH_MS = 5 * 60_000;

type Held = { uuid: string; code: string; since: number; lastReminder: number };

export type JoinDecision = { action: "release" | "hold"; reason: string };

/** Pure: what to do with a join, given what the portal knows about that UUID. */
export function decideJoin(user: { verifiedAt: Date | null; guildMember: boolean } | null): JoinDecision {
  if (!user) return { action: "hold", reason: "unknown uuid" };
  if (!user.verifiedAt) return { action: "hold", reason: "not linked" };
  if (!user.guildMember) return { action: "hold", reason: "left the discord server" };
  return { action: "release", reason: "linked member" };
}

export class Limbo {
  readonly held = new Map<string, Held>(); // by player name
  private ctx: ActionCtx;
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly env: Env, private readonly amp: Amp, private readonly tail: ConsoleTail, private readonly log: (o: unknown, m: string) => void) {
    this.ctx = { limbo: parsePos(env.LIMBO_POS), spawn: env.SPAWN_POS ? parsePos(env.SPAWN_POS) : null, portalUrl: env.PORTAL_URL };
  }

  get actionCtx() {
    return this.ctx;
  }

  start() {
    this.tail.on((e) => void this.onEvent(e).catch((err) => this.log({ err: String(err) }, "limbo event failed")));
    this.timers.push(setInterval(() => void this.tick().catch((err) => this.log({ err: String(err) }, "limbo tick failed")), 5000));
    this.timers.push(setInterval(() => void this.refreshGuild().catch((err) => this.log({ err: String(err) }, "guild refresh failed")), GUILD_REFRESH_MS));
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
  }

  private async onEvent(e: ConsoleEvent) {
    if (e.type === "join") await this.onJoin(e.name);
    if (e.type === "leave") this.held.delete(e.name);
    if (e.type === "list") for (const name of [...this.held.keys()]) if (!e.names.includes(name)) this.held.delete(name);
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
    const user = uuid ? await db.user.findFirst({ where: { mcUuid: uuid }, select: { id: true, verifiedAt: true, guildMember: true, mcUsername: true } }) : null;
    const decision = decideJoin(user);
    this.log({ name, uuid, decision }, "join");
    if (decision.action === "release") {
      if (user && user.mcUsername !== name) await db.user.update({ where: { id: user.id }, data: { mcUsername: name } }); // name change
      await runAction(this.amp, this.ctx, "link.release", { name }, null);
      return;
    }
    await this.hold(name, uuid ?? "", decision.reason);
  }

  private async hold(name: string, uuid: string, reason: string) {
    const code = uuid ? await this.codeFor(uuid, name) : codeGen();
    this.held.set(name, { uuid, code, since: Date.now(), lastReminder: Date.now() });
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
        await runAction(this.amp, this.ctx, "limbo.kickIdle", { name }, null);
        this.held.delete(name);
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
