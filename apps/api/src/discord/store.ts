import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { getSection } from "../settings.js";
import { readOptions, tallyPoll } from "../shared/polls.js";
import { SYNCED_KEY } from "../players/pack.js";
import { SERVER_MODS_KEY } from "../modpack/server-mods.js";
import type { FeedState, FeedStore, PostRow } from "./announcer.js";
import type { PollView } from "./lines.js";
import { currentSeasonId, readSeasonFile, seasonsDir } from "../seasons/files.js";
import { findByTitle } from "../shared/season.js";

// docs/21: what the Announcer reads and keeps. Its place in the event log, the refusals and the last 20 messages are
// one Setting row; the messages it edits later are DiscordPost rows.
const STATE_KEY = "_discordFeed";
const NEWS_DIR = path.join(process.env.DATA_DIR ?? "/repo/data", "news");
const PHOTO = /^news-[0-9a-f]{16}\.(png|webp|jpg)$/; // web's lib/image-kind.ts PHOTO_NAME
const PHOTO_TYPE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

/** A poll option that is a mod shows the mod's name (docs/21 §5); the names are read from modpack/mods.json. */
let modNames: { at: number; names: Map<string, string> } | null = null;
async function modName(slug: string): Promise<string | null> {
  if (!modNames || Date.now() - modNames.at > 10 * 60_000) {
    const names = new Map<string, string>();
    try {
      const m = JSON.parse(await readFile(path.join(process.env.REPO_DIR ?? "/repo", "modpack", "mods.json"), "utf8")) as { mods?: Array<{ slug?: unknown; name?: unknown }> };
      for (const mod of m.mods ?? []) if (typeof mod.slug === "string" && typeof mod.name === "string") names.set(mod.slug, mod.name);
    } catch {
      // no names: the option's own text
    }
    modNames = { at: Date.now(), names };
  }
  return modNames.names.get(slug) ?? null;
}

async function members(): Promise<number> {
  return db.user.count();
}

/** A ballot's mods that got half the votes or more (the rule Apply results uses, without exclusive groups). */
function modsIn(result: unknown): number {
  const mods = (result as { mods?: Array<{ pct?: unknown }> } | null)?.mods;
  return Array.isArray(mods) ? mods.filter((m) => typeof m.pct === "number" && m.pct >= 50).length : 0;
}

async function pollView(id: string): Promise<PollView | null> {
  const poll = await db.poll.findUnique({ where: { id }, include: { answers: { select: { choices: true } } } });
  if (!poll || poll.status === "DRAFT") return null;
  const opts = readOptions(poll.options);
  const options = await Promise.all(opts.filter((o) => o.id !== "dont-mind").map(async (o) => (o.modId ? (await modName(o.modId)) ?? o.text : o.text) || o.text));
  const t = tallyPoll(poll.options, poll.answers);
  return {
    kind: "poll", id, title: poll.question, options, closesAt: poll.closesAt, mustVote: poll.mustVote, voters: t.voters, members: await members(),
    status: poll.status === "OPEN" ? "OPEN" : "CLOSED",
    ...(poll.status === "CLOSED" ? { result: t.counts.map((c) => ({ text: c.text, votes: c.votes })), winners: t.winners } : {}),
  };
}

async function ballotView(id: string): Promise<PollView | null> {
  const vote = await db.vote.findUnique({ where: { id }, include: { _count: { select: { ballots: true } } } });
  if (!vote || vote.status === "DRAFT") return null;
  return {
    kind: "ballot", id, title: vote.title, options: [], closesAt: vote.closesAt, mustVote: vote.mustVote, voters: vote._count.ballots, members: await members(),
    status: vote.status === "OPEN" ? "OPEN" : "CLOSED",
    ...(vote.status === "CLOSED" ? { modsIn: modsIn(vote.resultJson) } : {}),
  };
}

export function prismaFeedStore(portal: string, repoDir?: string): FeedStore {
  let loadedCache: { at: number; ids: ReadonlySet<string> | null } | null = null;
  return {
    // docs/21 §6: the season's file, for the posts' titles and first messages
    async season(id) {
      return repoDir ? readSeasonFile(seasonsDir(repoDir), id) : null;
    },
    async seasonTitle(title) {
      if (!repoDir || !title) return false;
      const id = await currentSeasonId(seasonsDir(repoDir));
      const file = id ? await readSeasonFile(seasonsDir(repoDir), id) : null;
      return Boolean(file && findByTitle(file, title));
    },
    async newestEventId() {
      return (await db.event.findFirst({ orderBy: { id: "desc" }, select: { id: true } }))?.id ?? 0n;
    },
    async eventsAfter(id, limit) {
      return db.event.findMany({ where: { id: { gt: id } }, orderBy: { id: "asc" }, take: limit, select: { id: true, at: true, kind: true, actor: true, message: true, meta: true } });
    },
    async loadState() {
      const v = (await db.setting.findUnique({ where: { key: STATE_KEY } }))?.value as Partial<FeedState> | null | undefined;
      if (!v || typeof v !== "object") return null;
      return { cursor: typeof v.cursor === "string" ? v.cursor : null, hash: typeof v.hash === "string" ? v.hash : "", refused: v.refused && typeof v.refused === "object" ? v.refused : {}, log: Array.isArray(v.log) ? v.log.slice(0, 20) : [] };
    },
    async saveState(s) {
      const value = s as unknown as Prisma.InputJsonValue;
      await db.setting.upsert({ where: { key: STATE_KEY }, create: { key: STATE_KEY, value }, update: { value } });
    },
    async member(uuid) {
      const u = await db.user.findFirst({ where: { mcUuid: uuid }, select: { id: true } });
      return u ? { userId: u.id } : null;
    },
    async online() {
      return db.session.count({ where: { leftAt: null } });
    },
    async vote(kind, id) {
      return kind === "poll" ? pollView(id) : ballotView(id);
    },
    async remindable(now) {
      const soon = new Date(now.getTime() + 24 * 60 * 60_000);
      const [polls, votes] = await Promise.all([
        db.poll.findMany({ where: { status: "OPEN", closesAt: { gt: now, lte: soon } }, select: { id: true, openedAt: true, createdAt: true, closesAt: true } }),
        db.vote.findMany({ where: { status: "OPEN", closesAt: { gt: now, lte: soon } }, select: { id: true, opensAt: true, closesAt: true } }),
      ]);
      const day = 24 * 60 * 60_000;
      // only a vote that was open before the 24-hour mark: one opened with less than a day to go has just been posted
      const out: PollView[] = [];
      for (const p of polls) if ((p.openedAt ?? p.createdAt).getTime() <= p.closesAt!.getTime() - day) { const v = await pollView(p.id); if (v) out.push(v); }
      for (const b of votes) if (b.opensAt && b.opensAt.getTime() <= b.closesAt!.getTime() - day) { const v = await ballotView(b.id); if (v) out.push(v); }
      return out;
    },
    async unvoted(kind, id) {
      const users = await db.user.findMany({
        where: kind === "poll" ? { pollAnswers: { none: { pollId: id } } } : { ballots: { none: { voteId: id } } },
        select: { discordId: true },
      });
      const discordIds = users.map((u) => u.discordId).filter((d): d is string => typeof d === "string" && /^\d{5,25}$/.test(d));
      return { discordIds, others: users.length - discordIds.length };
    },
    async news(id) {
      const a = await db.announcement.findUnique({ where: { id }, select: { body: true, image: true } });
      return a ? { body: a.body, image: a.image } : null;
    },
    async picture(file) {
      const m = PHOTO.exec(file);
      if (!m) return null;
      try {
        return { name: file, type: PHOTO_TYPE[m[1]!]!, data: await readFile(path.join(NEWS_DIR, file)) };
      } catch {
        return null;
      }
    },
    async packChange() {
      const v = (await db.setting.findUnique({ where: { key: SYNCED_KEY } }))?.value as { version?: unknown; previous?: unknown; changed?: unknown; at?: unknown } | null | undefined;
      if (!v || typeof v.version !== "string" || typeof v.at !== "string") return null;
      return { version: v.version, previous: typeof v.previous === "string" ? v.previous : null, changed: typeof v.changed === "number" ? v.changed : 0, at: new Date(v.at) };
    },
    async post(key) {
      const r = await db.discordPost.findUnique({ where: { key } });
      return r ? { key: r.key, channel: r.channel === "admin" ? "admin" : r.channel === "updates" ? "updates" : "feed", messageId: r.messageId, postedAt: r.postedAt, editedAt: r.editedAt, via: r.via === "bot" ? "bot" : "webhook", threadId: r.threadId } : null;
    },
    async savePost(row: PostRow) {
      const data = { channel: row.channel, messageId: row.messageId, postedAt: row.postedAt, editedAt: row.editedAt, via: row.via ?? "webhook", threadId: row.threadId ?? null };
      await db.discordPost.upsert({ where: { key: row.key }, create: { key: row.key, ...data }, update: data });
    },
    async addError(message, meta) {
      await db.event.create({ data: { kind: "ERROR", actor: null, message, meta: meta as Prisma.InputJsonValue } });
    },
    async switches() {
      return getSection("discord");
    },
    async loadedMods() {
      // asked for each ERROR event; the list changes only when the server starts, so a minute's cache is plenty
      if (loadedCache && Date.now() - loadedCache.at < 60_000) return loadedCache.ids;
      const row = await db.setting.findUnique({ where: { key: SERVER_MODS_KEY } });
      const ids = (row?.value as { modIds?: unknown } | null)?.modIds;
      const set = Array.isArray(ids) && ids.length ? new Set(ids.filter((x): x is string => typeof x === "string")) : null;
      loadedCache = { at: Date.now(), ids: set };
      return set;
    },
    async brand() {
      const b = await getSection("branding");
      return { name: b.name, avatar: b.logoChoice ? `${portal}/brand/logo-256.png?v=${encodeURIComponent(b.logo || b.logoChoice)}` : null };
    },
  };
}
