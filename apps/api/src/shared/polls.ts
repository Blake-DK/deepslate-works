// SHARED FILE: apps/web/src/shared/ and apps/api/src/shared/ hold identical copies (a test compares them).
// Edit the copy in apps/web, then `cp apps/web/src/shared/*.ts apps/api/src/shared/`.
//
// Planner 2026-10-02, "votes before play": quick polls. One question, 2 to 8 options and "I don't mind" (added to
// every poll, so nobody is forced to pick a side), single or multiple choice, optionally closing by itself. A poll that
// is "must vote" is asked in the app and on the site before Play, and the door holds a member who has not answered it.
// Pure, so it is tested; web and api both read the database with these rules.

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 8;
export const DONT_MIND = { id: "dont-mind", text: "I don't mind" } as const;

export type PollOption = { id: string; text: string; image?: string | null; link?: string | null; modId?: string | null };
export type PollLike = { id: string; question: string; options: unknown; multiple: boolean; mustVote: boolean; status: "DRAFT" | "OPEN" | "CLOSED"; openedAt: Date | null; closesAt: Date | null };

/** What the room says, and the app and the site in their own words (VOTE_FIRST_BUTTON). */
export const VOTE_FIRST_TEXT = (host: string) => `There's a new vote. Open Deepslate Works or ${host} to vote, then you're in.`;
export const VOTE_FIRST_BUTTON = "Vote first, it takes ten seconds";

const LINK = /^https?:\/\/[^\s]{1,300}$/i;

/** The options as stored, tidied: known fields only, ids kept, "I don't mind" last and only once. */
export function readOptions(raw: unknown): PollOption[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: PollOption[] = [];
  for (const o of list) {
    if (!o || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.text !== "string" || r.id === DONT_MIND.id) continue;
    out.push({ id: r.id, text: r.text, image: typeof r.image === "string" ? r.image : null, link: typeof r.link === "string" && LINK.test(r.link) ? r.link : null, modId: typeof r.modId === "string" ? r.modId : null });
  }
  return [...out, { ...DONT_MIND }];
}

export type OptionInput = { text: string; image?: string | null; link?: string | null; modId?: string | null };
export type MadeOptions = { ok: true; options: PollOption[] } | { ok: false; reason: string };

/** The editor's rows into stored options: empty rows dropped, 2 to 8 left, ids o1..o8, "I don't mind" added. */
export function makeOptions(rows: OptionInput[]): MadeOptions {
  const kept = rows.map((r) => ({ ...r, text: r.text.trim(), link: r.link?.trim() || null, modId: r.modId?.trim() || null })).filter((r) => r.text !== "" || r.modId);
  if (kept.length < MIN_OPTIONS) return { ok: false, reason: `A poll needs at least ${MIN_OPTIONS} options.` };
  if (kept.length > MAX_OPTIONS) return { ok: false, reason: `A poll has at most ${MAX_OPTIONS} options (plus "I don't mind").` };
  if (kept.some((r) => r.text.length > 120)) return { ok: false, reason: "An option is longer than 120 characters." };
  if (kept.some((r) => r.link && !LINK.test(r.link))) return { ok: false, reason: "A link must start with http:// or https://." };
  const texts = kept.map((r) => r.text.toLowerCase()).filter(Boolean);
  if (new Set(texts).size !== texts.length) return { ok: false, reason: "Two options say the same thing." };
  if (texts.includes(DONT_MIND.text.toLowerCase())) return { ok: false, reason: `"${DONT_MIND.text}" is added to every poll by itself.` };
  return { ok: true, options: readOptions(kept.map((r, i) => ({ id: `o${i + 1}`, text: r.text, image: r.image ?? null, link: r.link, modId: r.modId }))) };
}

/** Open: opened, not closed, and its date (if any) not passed. */
export function isOpen(p: Pick<PollLike, "status" | "closesAt">, now: Date): boolean {
  return p.status === "OPEN" && (!p.closesAt || p.closesAt.getTime() > now.getTime());
}

/** Due to close by itself: still marked open, its date passed. */
export function dueToClose(p: Pick<PollLike, "status" | "closesAt">, now: Date): boolean {
  return p.status === "OPEN" && Boolean(p.closesAt) && p.closesAt!.getTime() <= now.getTime();
}

export type Choices = { ok: true; choices: string[] } | { ok: false; reason: string };

/** A member's answer, checked against the poll: known options only, one for single choice, "I don't mind" alone. */
export function checkChoices(p: Pick<PollLike, "options" | "multiple">, raw: unknown): Choices {
  const ids = new Set(readOptions(p.options).map((o) => o.id));
  const picked = [...new Set((Array.isArray(raw) ? raw : [raw]).filter((c): c is string => typeof c === "string"))];
  if (picked.length === 0) return { ok: false, reason: "Pick an option first." };
  if (picked.some((c) => !ids.has(c))) return { ok: false, reason: "That option isn't in this poll." };
  if (!p.multiple && picked.length > 1) return { ok: false, reason: "Pick one option." };
  if (picked.includes(DONT_MIND.id) && picked.length > 1) return { ok: false, reason: `"${DONT_MIND.text}" goes on its own.` };
  return { ok: true, choices: picked };
}

export type Count = { id: string; text: string; votes: number; percent: number };
export type Tally = { voters: number; counts: Count[]; winners: string[] };

/**
 * Votes per option, in the poll's order. `percent` is of the members who voted (so with multiple choice they add up to
 * more than 100). Winners: the options with the most votes, "I don't mind" never among them; none when nobody picked one.
 */
export function tallyPoll(options: unknown, answers: Array<{ choices: string[] }>): Tally {
  const opts = readOptions(options);
  const n = new Map(opts.map((o) => [o.id, 0]));
  for (const a of answers) for (const c of new Set(a.choices)) if (n.has(c)) n.set(c, n.get(c)! + 1);
  const voters = answers.length;
  const counts = opts.map((o) => ({ id: o.id, text: o.text, votes: n.get(o.id)!, percent: voters ? Math.round((n.get(o.id)! / voters) * 100) : 0 }));
  const real = counts.filter((c) => c.id !== DONT_MIND.id);
  const top = Math.max(0, ...real.map((c) => c.votes));
  return { voters, counts, winners: top > 0 ? real.filter((c) => c.votes === top).map((c) => c.text) : [] };
}

/** "Lava Golem" / "a tie between A and B" / "no clear answer". */
export function resultLine(t: Tally): string {
  if (t.winners.length === 0) return "no clear answer";
  if (t.winners.length === 1) return t.winners[0]!;
  return `a tie between ${t.winners.slice(0, -1).join(", ")} and ${t.winners.at(-1)}`;
}

/** The news items the portal posts by itself when a poll opens and when it closes. */
export function openedNews(question: string, closesAt: string | null, mustVote: boolean): string {
  return `New vote: ${question}${closesAt ? ` (open until ${closesAt})` : ""}. ${mustVote ? "Vote in Deepslate Works or on the site before your next game." : "Vote in Deepslate Works or on the site."}`;
}
export function closedNews(question: string, t: Tally): string {
  return `Vote closed: ${question} Result: ${resultLine(t)} (${t.voters} ${t.voters === 1 ? "vote" : "votes"}).`;
}

/** The chat line for whoever is playing when a must-vote poll opens: nobody is kicked or held for it now. */
export function openedChat(question: string, host: string): string {
  return `New vote: ${question} Vote in Deepslate Works or on ${host}; it's asked before your next game.`;
}

/**
 * Must-vote polls (and a must-vote mod ballot) a member has not answered, oldest first. Every member is asked; only
 * `holds` decides whether the door keeps them waiting: admins are asked like everyone else but never held.
 */
export type Pending = { kind: "poll" | "ballot"; id: string; title: string; openedAt: Date | null };
export function pendingOrder(list: Pending[]): Pending[] {
  return [...list].sort((a, b) => (a.openedAt?.getTime() ?? 0) - (b.openedAt?.getTime() ?? 0) || a.id.localeCompare(b.id));
}
export function voteHolds(user: { role: "ADMIN" | "PLAYER" }, unanswered: number): boolean {
  return user.role !== "ADMIN" && unanswered > 0;
}
