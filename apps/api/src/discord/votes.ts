// docs/22 §4: voting with Discord's buttons. The vote is stored by the site's own rule (shared/polls.ts castVote).
import { db } from "../db.js";
import { audit } from "../audit.js";
import { castVote, DONT_MIND, readOptions, tallyPoll, type VoteStore } from "../shared/polls.js";
import { unvotedFor } from "../players/polls.js";
import { escapeText } from "./lines.js";
import type { Component } from "./rest.js";

export const SIGN_IN_FIRST = (host: string) => `Sign in at ${host} once, then try again.`;

/** Single choice: one button per option, "I don't mind" last and grey, five to a row. Multiple: one menu. */
export function voteComponents(poll: { id: string; options: unknown; multiple: boolean }, closed = false): Component[] {
  if (closed) return [];
  const opts = readOptions(poll.options);
  if (poll.multiple) {
    return [{ type: 1, components: [{ type: 3, custom_id: `votes:${poll.id}`, placeholder: "Pick as many as you like", min_values: 1, max_values: opts.length, options: opts.map((o) => ({ label: o.text.slice(0, 100) || o.id, value: o.id })) }] }];
  }
  const rows: Component[] = [];
  for (let i = 0; i < opts.length && rows.length < 5; i += 5) {
    rows.push({ type: 1, components: opts.slice(i, i + 5).map((o) => ({ type: 2 as const, style: o.id === DONT_MIND.id ? (2 as const) : (1 as const), label: (o.text || o.id).slice(0, 80), custom_id: `vote:${poll.id}:${o.id}` })) });
  }
  return rows;
}

/** A button's or the menu's custom id → the poll and what was picked. */
export function readPress(customId: string, values?: string[]): { pollId: string; choices: string[] } | null {
  let m = /^vote:([\w-]{1,40}):([\w-]{1,40})$/.exec(customId);
  if (m) return { pollId: m[1]!, choices: [m[2]!] };
  m = /^votes:([\w-]{1,40})$/.exec(customId);
  if (m && Array.isArray(values)) return { pollId: m[1]!, choices: values.filter((v) => typeof v === "string").slice(0, 25) };
  return null;
}

/** Who the vote was saved for, and (for a must-vote poll) how many votes are still asked before they play. */
export type VotedFor = { name: string; mustVote: boolean; stillToVote: number };

/**
 * "You voted for **X**", that it is their vote on the site too (Alex, 2026-10-06: nobody should think they have to
 * vote twice), whether they can play now, and the results so far, as the site shows them after a vote.
 */
export function votedText(texts: string[], counts: Array<{ text: string; votes: number; percent: number }>, voters: number, changed: boolean, who?: VotedFor): string {
  const picked = texts.map((t) => `**${escapeText(t)}**`).join(", ");
  const lines = counts.map((c) => `${escapeText(c.text)} · ${c.votes} (${c.percent}%)`);
  const head = [`${changed ? "You changed your vote to" : "You voted for"} ${picked}. You can change it until it closes.`];
  if (who) {
    head.push(`It's saved to your account on the site (**${escapeText(who.name)}**), so you don't need to vote there as well.`);
    if (who.mustVote) head.push(who.stillToVote === 0 ? "That was the vote you needed before playing: you can join the server now." : `${who.stillToVote} more ${who.stillToVote === 1 ? "vote" : "votes"} to answer before you can play.`);
  }
  return `${head.join("\n")}\n\nSo far, ${voters} ${voters === 1 ? "vote" : "votes"}:\n${lines.join("\n")}`;
}

export type Pressed = { ok: true; text: string } | { ok: false; text: string };

/** A press from Discord user `discordId`: the member on the portal votes, by the one rule. */
export async function pressVote(discordId: string, pollId: string, choices: string[], host: string): Promise<Pressed> {
  const user = await db.user.findUnique({ where: { discordId }, select: { id: true, displayName: true } });
  if (!user) return { ok: false, text: SIGN_IN_FIRST(host) };
  const r = await castVote(db as unknown as VoteStore, (a) => audit(a as Parameters<typeof audit>[0]), user.id, pollId, choices, "discord");
  if (!r.ok) return { ok: false, text: r.message };
  const poll = await db.poll.findUnique({ where: { id: pollId }, include: { answers: { select: { choices: true } } } });
  const t = poll ? tallyPoll(poll.options, poll.answers) : { voters: 0, counts: [] };
  const mustVote = Boolean(poll?.mustVote);
  const stillToVote = mustVote ? await unvotedFor(user.id) : 0;
  return { ok: true, text: votedText(r.texts, t.counts, t.voters, r.changed, { name: user.displayName, mustVote, stillToVote }) };
}
