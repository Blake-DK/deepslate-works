// docs/22 §4: voting with Discord's buttons. The vote is stored by the site's own rule (shared/polls.ts castVote).
import { db } from "../db.js";
import { audit } from "../audit.js";
import { castVote, DONT_MIND, readOptions, tallyPoll, type VoteStore } from "../shared/polls.js";
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

/** "You voted for **X**", and the results so far, as the site shows them after a vote. */
export function votedText(texts: string[], counts: Array<{ text: string; votes: number; percent: number }>, voters: number, changed: boolean): string {
  const picked = texts.map((t) => `**${escapeText(t)}**`).join(", ");
  const lines = counts.map((c) => `${escapeText(c.text)} · ${c.votes} (${c.percent}%)`);
  return `${changed ? "You changed your vote to" : "You voted for"} ${picked}. You can change it until it closes.\n\nSo far, ${voters} ${voters === 1 ? "vote" : "votes"}:\n${lines.join("\n")}`;
}

export type Pressed = { ok: true; text: string } | { ok: false; text: string };

/** A press from Discord user `discordId`: the member on the portal votes, by the one rule. */
export async function pressVote(discordId: string, pollId: string, choices: string[], host: string): Promise<Pressed> {
  const user = await db.user.findUnique({ where: { discordId }, select: { id: true } });
  if (!user) return { ok: false, text: SIGN_IN_FIRST(host) };
  const r = await castVote(db as unknown as VoteStore, (a) => audit(a as Parameters<typeof audit>[0]), user.id, pollId, choices, "discord");
  if (!r.ok) return { ok: false, text: r.message };
  const poll = await db.poll.findUnique({ where: { id: pollId }, include: { answers: { select: { choices: true } } } });
  const t = poll ? tallyPoll(poll.options, poll.answers) : { voters: 0, counts: [] };
  return { ok: true, text: votedText(r.texts, t.counts, t.voters, r.changed) };
}
