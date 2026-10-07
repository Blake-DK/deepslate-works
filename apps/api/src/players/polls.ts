import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { requireAdmin } from "../auth.js";
import { audit } from "../audit.js";
import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import { runAction } from "../actions/run.js";
import type { ActionCtx } from "../actions/registry.js";
import { closedNews, resultLine, tallyPoll } from "../shared/polls.js";

// Planner 2026-10-02, "votes before play". The door asks how many open must-vote polls (and a must-vote mod ballot) a
// member has not answered; polls with a closing date are closed here when it passes (with their news item), whether or
// not anybody has the site open; and a poll that opens while people are playing is one chat line, never a hold.

/** Open must-vote polls, and an open must-vote mod ballot, that this member has not answered. */
export async function unvotedFor(userId: string, now = new Date()): Promise<number> {
  const open = { OR: [{ closesAt: null }, { closesAt: { gt: now } }] };
  const [polls, ballots] = await Promise.all([
    db.poll.count({ where: { status: "OPEN", mustVote: true, ...open, answers: { none: { userId } } } }),
    db.vote.count({ where: { status: "OPEN", mustVote: true, ...open, ballots: { none: { userId } } } }),
  ]);
  return polls + ballots;
}

/** The author of what the portal announces by itself (web's server/announcements.ts SYSTEM_AUTHOR). */
const SYSTEM_AUTHOR = "system";

/** A poll whose date has passed: closed once (whoever gets there first, web or here, wins the update), with its news. */
export async function closeDuePolls(now = new Date()): Promise<number> {
  const due = await db.poll.findMany({ where: { status: "OPEN", closesAt: { lte: now } }, select: { id: true } });
  let closed = 0;
  for (const { id } of due) {
    const claimed = await db.poll.updateMany({ where: { id, status: "OPEN" }, data: { status: "CLOSED", closedAt: now, closedBy: SYSTEM_AUTHOR } });
    if (claimed.count !== 1) continue;
    const poll = await db.poll.findUnique({ where: { id }, include: { answers: { select: { choices: true } } } });
    if (!poll) continue;
    const t = tallyPoll(poll.options, poll.answers);
    await db.announcement.create({ data: { body: closedNews(poll.question, t), authorId: SYSTEM_AUTHOR } });
    await audit({ userId: null, action: "poll.close", params: { pollId: id, question: poll.question, auto: true, result: resultLine(t), voters: t.voters }, result: "OK" });
    closed++;
  }
  return closed;
}

export class PollWatch {
  private timer: NodeJS.Timeout | null = null;
  constructor(private readonly log: (o: unknown, m: string) => void) {}
  start() {
    const round = () => void closeDuePolls().catch((err) => this.log({ err: String(err) }, "closing polls failed"));
    round();
    this.timer = setInterval(round, 30_000);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

/** POST /polls/opened {question}: the chat line for whoever is playing (the site calls it when an admin opens a poll). */
export function pollRoutes(app: FastifyInstance, amp: Amp, tail: ConsoleTail, ctx: () => ActionCtx) {
  app.post("/polls/opened", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const question = String((req.body as { question?: unknown } | null)?.question ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
    if (!question) return reply.code(400).send({ error: { code: "bad_request", message: "question missing" } });
    if (tail.state !== 20 || tail.online.size === 0) return { told: 0 };
    const r = await runAction(amp, ctx(), "server.pollOpened", { question }, req.caller.userId); // the admin who opened it, on the event
    return { told: r.ok ? tail.online.size : 0 };
  });
}
