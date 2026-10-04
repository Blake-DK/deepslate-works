// docs/22: the bot, put together from what api already has (the server's view, the door, the actions, its own routes).
// With no DISCORD_BOT_TOKEN nothing here is made and nothing changes (§2.8).
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { audit } from "../audit.js";
import type { Env } from "../env.js";
import { getSection, setSection } from "../settings.js";
import { serverPack } from "../players/pack.js";
import { stateLine, type ServerState } from "../shared/server-state.js";
import { Bot } from "./bot.js";
import { BotRest } from "./rest.js";
import type { CommandDeps, Member } from "./commands.js";
import { pressVote, voteComponents } from "./votes.js";
import type { VotePoster } from "./announcer.js";
import { currentSeason } from "../seasons/files.js";
import { prismaSeasonStore } from "../seasons/store.js";
import { scoreboard, seasonCurrent, seasonLine } from "../shared/season.js";

export type BotWiring = {
  app: FastifyInstance;
  env: Env;
  log: (o: unknown, m: string) => void;
  server: () => { state: ServerState; players: string[]; tps: number | null; sleepInMin: number | null };
  /** chat.fromDiscord, only when the server runs and somebody is on. */
  toGame: (line: { name: string; text: string; member: string | null }) => Promise<"sent" | "nobody" | "failed">;
  memberChanged: (discordId: string, inGuild: boolean) => Promise<void>;
};

const isId = (v: string | undefined) => (v && /^\d{5,25}$/.test(v) ? v : null);

/** The Discord app's id and the guild, when both are usable; null = no bot. */
export function botConfig(env: Env): { token: string; guild: string; clientId: string | null } | null {
  const guild = isId(env.DISCORD_GUILD_ID);
  if (!env.DISCORD_BOT_TOKEN || !guild) return null;
  return { token: env.DISCORD_BOT_TOKEN, guild, clientId: isId(env.DISCORD_CLIENT_ID) };
}

async function currentApp(repo: string): Promise<string | null> {
  try {
    const j = JSON.parse(await readFile(path.join(repo, "dist", "installer.json"), "utf8")) as { version?: string; exe?: { version?: string } };
    return j.exe?.version ?? j.version ?? null;
  } catch {
    return null;
  }
}

export function makeBot(w: BotWiring): Bot | null {
  const cfg = botConfig(w.env);
  if (!cfg) return null;
  const portal = w.env.PORTAL_URL.replace(/\/+$/, "");
  const host = new URL(portal).host;
  const rest = new BotRest(cfg.token);
  const member = async (discordId: string): Promise<Member | null> => {
    const u = await db.user.findUnique({ where: { discordId }, select: { id: true, role: true, mcUsername: true } });
    return u ? { id: u.id, role: u.role === "ADMIN" ? "ADMIN" : "PLAYER", mcUsername: u.mcUsername } : null;
  };
  const seasonFile = currentSeason(w.env.REPO_DIR, w.log);
  const ukDayTime = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
    const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
    return `${get("weekday")} ${get("day")} ${get("month")}, ${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
  };
  const commands: CommandDeps = {
    host,
    portal,
    member,
    // docs/20 §7: /season, the same line as the site's Home, and where the member stands
    async season(userId) {
      const file = await seasonFile();
      const row = file ? await prismaSeasonStore.season(file.id) : null;
      if (!file || !row) return { line: null, mine: null };
      const line = seasonLine(seasonCurrent(file, row.state, new Date()), ukDayTime);
      const uuid = userId ? (await db.user.findUnique({ where: { id: userId }, select: { mcUuid: true } }))?.mcUuid : null;
      const board = uuid && row.state !== "upcoming" ? scoreboard(file, await prismaSeasonStore.clears(file.id)) : [];
      const at = board.findIndex((r) => r.mcUuid === uuid);
      return { line, mine: at >= 0 ? { place: at + 1, points: board[at]!.points } : null };
    },
    server: w.server,
    pack: serverPack,
    async openVotes(userId) {
      const now = new Date();
      const polls = await db.poll.findMany({ where: { status: "OPEN", OR: [{ closesAt: null }, { closesAt: { gt: now } }] }, orderBy: { openedAt: "asc" }, select: { id: true, question: true, answers: userId ? { where: { userId }, select: { id: true } } : false } });
      const posts = await db.discordPost.findMany({ where: { key: { in: polls.map((p) => `poll:${p.id}`) } }, select: { key: true, threadId: true, messageId: true } });
      const guild = cfg.guild;
      return polls.map((p) => {
        const post = posts.find((x) => x.key === `poll:${p.id}`);
        const link = post?.threadId ? `https://discord.com/channels/${guild}/${post.threadId}` : `${portal}/votes`;
        return { title: p.question, link, answered: userId ? (p.answers as unknown[]).length > 0 : null };
      });
    },
    async me(userId) {
      const u = await db.user.findUnique({ where: { id: userId }, select: { mcUsername: true, mcUuid: true } });
      const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
      const sessions = u?.mcUuid ? await db.session.findMany({ where: { mcUuid: u.mcUuid, OR: [{ leftAt: null }, { leftAt: { gte: monthStart } }] }, select: { joinedAt: true, leftAt: true } }) : [];
      const last = u?.mcUuid ? await db.session.findFirst({ where: { mcUuid: u.mcUuid }, orderBy: { joinedAt: "desc" }, select: { joinedAt: true, leftAt: true } }) : null;
      const ms = sessions.reduce((t, s) => t + Math.max(0, (s.leftAt ?? new Date()).getTime() - Math.max(s.joinedAt.getTime(), monthStart.getTime())), 0);
      const report = await db.installReport.findFirst({ where: { userId, outcome: "ok" }, orderBy: { at: "desc" }, select: { installerVersion: true, packVersion: true } });
      return {
        mcName: u?.mcUsername ?? null,
        lastPlayed: last ? (last.leftAt ?? last.joinedAt) : null,
        hoursThisMonth: ms / 3_600_000,
        app: report?.installerVersion ?? null,
        currentApp: await currentApp(w.env.REPO_DIR),
        pack: report?.packVersion ?? null,
        currentPack: await serverPack(),
      };
    },
    async route(m, method, url, body) {
      // the route's own permission check and audit, as this member, marked "via Discord"
      const res = await w.app.inject({
        method, url, payload: body as never,
        headers: { authorization: `Bearer ${w.env.API_SERVICE_TOKEN}`, "x-via": "discord", "x-user-id": m.id, "x-user-role": m.role, ...(m.mcUsername ? { "x-mc-username": m.mcUsername } : {}) },
      });
      let parsed: unknown = null;
      try {
        parsed = res.json();
      } catch {
        parsed = null;
      }
      return { status: res.statusCode, body: parsed as never };
    },
    async setPaused(paused, m) {
      const current = await getSection("discord");
      await setSection("discord", { ...current, paused }, m.id);
      await audit({ userId: m.id, action: "discord.settings", params: { paused, wasPaused: current.paused, via: "discord" }, result: "OK" });
    },
  };
  return new Bot({
    ...cfg,
    rest,
    log: w.log,
    switches: () => getSection("discord"),
    commands,
    vote: (discordId, pollId, choices) => pressVote(discordId, pollId, choices, host),
    toGame: w.toGame,
    async memberName(discordId) {
      const u = await db.user.findUnique({ where: { discordId }, select: { id: true, mcUsername: true } });
      return u ? { userId: u.id, mcName: u.mcUsername } : null;
    },
    memberChanged: w.memberChanged,
    presence() {
      const s = w.server();
      if (s.state === "online") return s.players.length ? `${s.players.length} online` : "Online, nobody on";
      if (s.state === "asleep") return "Asleep, press Play to wake it";
      return stateLine(s.state, {});
    },
  });
}

/** The Announcer's view of the bot: votes with buttons as its own forum posts. */
export function votePoster(bot: Bot): VotePoster {
  return {
    get inGuild() {
      return bot.inGuild && bot.gateway.state === "on";
    },
    createPost: (forum, title, message, tag) => bot.createPost(forum, title, message, tag),
    edit: (channel, id, message) => bot.edit(channel, id, message),
    tagFor: (forum, name) => bot.tagFor(forum, name),
    sendTo: (channel, message) => bot.sendTo(channel, message),
    channelName: (id) => bot.channelName(id),
    components: (poll, closed) => voteComponents(poll, closed),
    pollShape: (id) => db.poll.findUnique({ where: { id }, select: { id: true, options: true, multiple: true } }),
  };
}
