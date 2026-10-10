import "server-only";
import type { Prisma } from "@prisma/client";
import type { Mod } from "modpack";
import { db } from "@/server/db";
import { audit } from "@/server/events";
import { apiFetch } from "@/server/api-client";
import { getManifest, modBySlug } from "@/server/modpack/manifest";
import { newsImageUrl, SYSTEM_AUTHOR } from "@/server/announcements";
import { ukShort } from "@/lib/uk-time";
import { removePhoto } from "@/server/news-images";
import { castVote, closedNews, DONT_MIND, editOptions, isOpen, openedNews, pendingOrder, readOptions, resultLine, tallyPoll, type EditRow, type PollOption, type Pending, type Tally, type VoteStore } from "@/shared/polls";

// Planner 2026-10-02, "votes before play": quick polls on the site and in the app, and must-vote. The rules are in
// shared/polls.ts (the api reads the same tables for the door and closes polls at their date: players/polls.ts).

export type Viewer = { id: string; role: "ADMIN" | "PLAYER" };

export type OptionView = PollOption & { imageUrl: string | null; mod: Pick<Mod, "slug" | "name" | "description" | "wiki"> | null };
export type PollView = {
  id: string;
  question: string;
  options: OptionView[];
  multiple: boolean;
  mustVote: boolean;
  open: boolean;
  openedAt: Date | null;
  closesAt: Date | null;
  closedAt: Date | null;
  /** What this member picked; null when they have not voted. */
  mine: string[] | null;
  /** Where their vote came from: the buttons in Discord count as a vote here (docs/22 §4). */
  mineVia: "site" | "discord" | null;
  /** After they voted, once it is closed, and always for admins. */
  results: Tally | null;
  /** Admins only: who voted for what. */
  voters: Array<{ name: string; choices: string[]; at: Date; via: "site" | "discord" }> | null;
};

const mods = async () => {
  try {
    return modBySlug(await getManifest());
  } catch {
    return new Map<string, Mod>();
  }
};

type Row = { id: string; question: string; options: unknown; multiple: boolean; mustVote: boolean; status: "DRAFT" | "OPEN" | "CLOSED"; openedAt: Date | null; closesAt: Date | null; closedAt: Date | null; answers: Array<{ userId: string; choices: string[]; via: string; updatedAt: Date; user?: { displayName: string } | null }> };

function view(p: Row, who: Viewer, bySlug: Map<string, Mod>, now: Date): PollView {
  const admin = who.role === "ADMIN";
  const answer = p.answers.find((a) => a.userId === who.id);
  const mine = answer?.choices ?? null;
  const open = isOpen(p, now);
  const options = readOptions(p.options).map((o) => {
    const m = o.modId ? bySlug.get(o.modId) : undefined;
    return { ...o, imageUrl: newsImageUrl(o.image), mod: m ? { slug: m.slug, name: m.name, description: m.description, wiki: m.wiki } : null };
  });
  const showResults = admin || mine !== null || !open;
  return {
    id: p.id, question: p.question, options, multiple: p.multiple, mustVote: p.mustVote, open, openedAt: p.openedAt, closesAt: p.closesAt, closedAt: p.closedAt, mine,
    mineVia: answer ? (answer.via === "discord" ? "discord" : "site") : null,
    results: showResults ? tallyPoll(p.options, p.answers) : null,
    voters: admin ? p.answers.map((a) => ({ name: a.user?.displayName ?? "someone who has left", choices: a.choices, at: a.updatedAt, via: a.via === "discord" ? ("discord" as const) : ("site" as const) })) : null,
  };
}

const withAnswers = (admin: boolean) => ({ answers: { select: { userId: true, choices: true, via: true, updatedAt: true, ...(admin ? { user: { select: { displayName: true } } } : {}) } } });

/** Open polls (oldest first) and the closed ones (newest first), as this member may see them. */
export async function listPolls(who: Viewer, closedLimit = 30): Promise<{ open: PollView[]; closed: PollView[] }> {
  const now = new Date();
  const admin = who.role === "ADMIN";
  const [rows, bySlug] = await Promise.all([
    db.poll.findMany({ where: { status: { in: ["OPEN", "CLOSED"] } }, orderBy: { openedAt: "desc" }, take: 200, include: withAnswers(admin) }),
    mods(),
  ]);
  const all = rows.map((r) => view(r, who, bySlug, now));
  return {
    open: all.filter((p) => p.open).sort((a, b) => (a.openedAt?.getTime() ?? 0) - (b.openedAt?.getTime() ?? 0)),
    closed: all.filter((p) => !p.open).sort((a, b) => (b.closedAt ?? b.closesAt ?? b.openedAt ?? now).getTime() - (a.closedAt ?? a.closesAt ?? a.openedAt ?? now).getTime()).slice(0, closedLimit),
  };
}

export async function getPoll(id: string, who: Viewer): Promise<PollView | null> {
  const [row, bySlug] = await Promise.all([db.poll.findUnique({ where: { id }, include: withAnswers(who.role === "ADMIN") }), mods()]);
  return row && row.status !== "DRAFT" ? view(row, who, bySlug, new Date()) : null;
}

/** What this member is asked before Play, oldest first: open must-vote polls they have not answered, and a must-vote mod ballot. */
export async function pendingFor(who: Viewer): Promise<{ polls: PollView[]; ballot: { id: string; title: string } | null; list: Pending[] }> {
  const now = new Date();
  const open = { OR: [{ closesAt: null }, { closesAt: { gt: now } }] };
  const [rows, ballot, bySlug] = await Promise.all([
    db.poll.findMany({ where: { status: "OPEN", mustVote: true, ...open, answers: { none: { userId: who.id } } }, orderBy: { openedAt: "asc" }, include: withAnswers(false) }),
    db.vote.findFirst({ where: { status: "OPEN", mustVote: true, ...open, ballots: { none: { userId: who.id } } }, orderBy: { opensAt: "asc" }, select: { id: true, title: true, opensAt: true } }),
    mods(),
  ]);
  const polls = rows.map((r) => view(r, { ...who, role: "PLAYER" }, bySlug, now)); // asked like everyone else
  const list = pendingOrder([...polls.map((p) => ({ kind: "poll" as const, id: p.id, title: p.question, openedAt: p.openedAt })), ...(ballot ? [{ kind: "ballot" as const, id: ballot.id, title: ballot.title, openedAt: ballot.opensAt }] : [])]);
  return { polls, ballot: ballot ? { id: ballot.id, title: ballot.title } : null, list };
}

export type Answered = { ok: true; poll: PollView; changed: boolean } | { ok: false; status: number; code: string; message: string };

/** A member's vote, or a changed vote while it is open. */
export async function answerPoll(who: Viewer & { displayName?: string }, pollId: string, raw: unknown): Promise<Answered> {
  // the rule itself is shared with api (Discord's vote buttons, docs/22 §4)
  const r = await castVote(db as unknown as VoteStore, (a) => audit(a), who.id, pollId, raw);
  if (!r.ok) return r;
  return { ok: true, poll: (await getPoll(pollId, who))!, changed: r.changed };
}

export type NewPoll = { question: string; options: PollOption[]; multiple: boolean; mustVote: boolean; closesAt: Date | null };

/** Admin → News & polls → Polls → New poll: opened at once, with its news item, a chat line for whoever is playing, and the event. */
export async function openPoll(admin: Viewer, p: NewPoll): Promise<string> {
  const now = new Date();
  const poll = await db.poll.create({ data: { question: p.question, options: p.options as unknown as Prisma.InputJsonValue, multiple: p.multiple, mustVote: p.mustVote, closesAt: p.closesAt, createdBy: admin.id, status: "OPEN", openedAt: now } });
  await db.announcement.create({ data: { body: openedNews(p.question, p.closesAt ? ukShort(p.closesAt) : null, p.mustVote), authorId: SYSTEM_AUTHOR } });
  await audit({ userId: admin.id, action: "poll.open", params: { pollId: poll.id, question: p.question, mustVote: p.mustVote, options: p.options.filter((o) => o.id !== DONT_MIND.id).map((o) => o.text), multiple: p.multiple, closesAt: p.closesAt?.toISOString() ?? null }, result: "OK" });
  // Somebody already playing is never held or kicked for it: a chat line, and it applies from their next join.
  await apiFetch("/polls/opened", { method: "POST", body: { question: p.question }, caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 10_000 }).catch(() => undefined);
  return poll.id;
}

/** Closed by an admin (the api closes the ones whose date passed): once, with the result as a news item. */
export async function closePoll(admin: Viewer, id: string): Promise<boolean> {
  const now = new Date();
  const claimed = await db.poll.updateMany({ where: { id, status: "OPEN" }, data: { status: "CLOSED", closedAt: now, closedBy: admin.id } });
  if (claimed.count !== 1) return false;
  const poll = await db.poll.findUnique({ where: { id }, include: { answers: { select: { choices: true } } } });
  if (!poll) return false;
  const t = tallyPoll(poll.options, poll.answers);
  await db.announcement.create({ data: { body: closedNews(poll.question, t), authorId: SYSTEM_AUTHOR } });
  await audit({ userId: admin.id, action: "poll.close", params: { pollId: id, question: poll.question, result: resultLine(t), voters: t.voters }, result: "OK" });
  return true;
}

/**
 * docs/35 R-40: pictures are named after their content and kept in one folder (news-images.ts), so a news item and
 * a poll's option may show the same file. True while anything still shows it.
 */
export async function photoInUse(file: string): Promise<boolean> {
  if ((await db.announcement.count({ where: { image: file } })) > 0) return true;
  const polls = await db.poll.findMany({ select: { options: true } });
  return polls.some((p) => readOptions(p.options).some((o) => o.image === file));
}

export type PollEdit = { question: string; rows: EditRow[]; multiple: boolean; mustVote: boolean; closesAt: Date | null };
export type Edit = { ok: true; changed: boolean } | { ok: false; reason: string };

/**
 * Admin → News & polls → Polls → Edit (Alex, 2026-10-06): an open poll's question, options, choice, closing date and must-vote. The
 * votes already cast stay (editOptions keeps each option's id); the Discord post is redrawn from the event.
 */
export async function editPoll(admin: Viewer, id: string, e: PollEdit): Promise<Edit> {
  const poll = await db.poll.findUnique({ where: { id }, include: { answers: { select: { choices: true } } } });
  if (!poll || !isOpen(poll, new Date())) return { ok: false, reason: "That poll has closed, so it can't be edited." };
  const made = editOptions(poll, poll.answers, e.rows, e.multiple);
  if (!made.ok) return made;
  const changes = [...made.changes];
  if (e.question !== poll.question) changes.unshift(`question was "${poll.question}"`);
  if ((e.closesAt?.getTime() ?? null) !== (poll.closesAt?.getTime() ?? null)) changes.push(e.closesAt ? `closes ${ukShort(e.closesAt)}` : "no closing date");
  if (e.mustVote !== poll.mustVote) changes.push(e.mustVote ? "must vote before playing" : "voting is optional");
  if (changes.length === 0) return { ok: true, changed: false };
  await db.poll.update({ where: { id }, data: { question: e.question, options: made.options as unknown as Prisma.InputJsonValue, multiple: e.multiple, mustVote: e.mustVote, closesAt: e.closesAt } });
  // a picture replaced or taken away with its option goes, unless something else still shows it
  const kept = new Set(made.options.map((o) => o.image));
  for (const file of new Set(readOptions(poll.options).map((o) => o.image))) {
    if (file && !kept.has(file) && !(await photoInUse(file))) await removePhoto(file);
  }
  await audit({ userId: admin.id, action: "poll.edit", params: { pollId: id, question: e.question, changes, mustVote: e.mustVote, answers: poll.answers.length }, result: "OK" });
  return { ok: true, changed: true };
}

/** The quick switch on an open poll: members answer it before they play, or not. Nobody playing is held or kicked. */
export async function setPollMustVote(admin: Viewer, id: string, on: boolean): Promise<boolean> {
  const poll = await db.poll.findUnique({ where: { id }, select: { question: true, mustVote: true, status: true, closesAt: true } });
  if (!poll || !isOpen(poll, new Date()) || poll.mustVote === on) return false;
  await db.poll.update({ where: { id }, data: { mustVote: on } });
  await audit({ userId: admin.id, action: "poll.mustVote", params: { pollId: id, question: poll.question, on }, result: "OK" });
  return true;
}

export async function deletePoll(admin: Viewer, id: string): Promise<void> {
  const poll = await db.poll.findUnique({ where: { id }, include: { _count: { select: { answers: true } } } });
  if (!poll) return;
  await db.poll.delete({ where: { id } });
  // its options' pictures go with it, unless a news item or another poll shows the same picture
  for (const file of new Set(readOptions(poll.options).map((o) => o.image))) {
    if (file && !(await photoInUse(file))) await removePhoto(file);
  }
  await audit({ userId: admin.id, action: "poll.delete", params: { pollId: id, question: poll.question, answers: poll._count.answers }, result: "OK" });
}

/** JSON-safe, for the poll card in the browser and for the app: dates as text, "closes" already in UK time. */
export type ClientPoll = Omit<PollView, "openedAt" | "closesAt" | "closedAt" | "voters"> & { openedAt: string | null; closes: string | null; closed: string | null; voters: Array<{ name: string; choices: string[]; at: string; via: "site" | "discord" }> | null };
export function forClient(p: PollView): ClientPoll {
  return {
    ...p,
    openedAt: p.openedAt?.toISOString() ?? null,
    closes: p.closesAt ? ukShort(p.closesAt) : null,
    closed: p.closedAt ? ukShort(p.closedAt) : p.closesAt && !p.open ? ukShort(p.closesAt) : null,
    voters: p.voters?.map((v) => ({ ...v, at: ukShort(v.at) })) ?? null,
  };
}
