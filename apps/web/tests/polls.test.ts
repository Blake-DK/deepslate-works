import { beforeEach, describe, expect, it, vi } from "vitest";
import { closedNews, DONT_MIND, makeOptions, openedNews, pendingOrder, readOptions, resultLine, tallyPoll, voteHolds } from "@/shared/polls";

// Planner 2026-10-02, "votes before play": quick polls on the site and in the app.

const db = vi.hoisted(() => ({
  poll: null as null | { id: string; question: string; options: unknown; multiple: boolean; mustVote: boolean; status: "OPEN" | "CLOSED"; openedAt: Date; closesAt: Date | null; closedAt: Date | null },
  answers: [] as Array<{ pollId: string; userId: string; choices: string[]; updatedAt: Date }>,
  audits: [] as Array<{ action: string; params: Record<string, unknown> }>,
}));
vi.mock("@/server/db", () => ({
  db: {
    poll: {
      findUnique: async ({ include }: { include?: unknown }) => (db.poll ? { ...db.poll, ...(include ? { answers: db.answers.map((a) => ({ ...a, user: { displayName: a.userId } })) } : {}) } : null),
    },
    pollAnswer: {
      findUnique: async ({ where }: { where: { pollId_userId: { userId: string } } }) => {
        const a = db.answers.find((x) => x.userId === where.pollId_userId.userId);
        return a ? { ...a, choices: [...a.choices] } : null; // a copy, as the database gives
      },
      upsert: async ({ where, create, update }: { where: { pollId_userId: { userId: string } }; create: { pollId: string; userId: string; choices: string[] }; update: { choices: string[] } }) => {
        const a = db.answers.find((x) => x.userId === where.pollId_userId.userId);
        if (a) Object.assign(a, update, { updatedAt: new Date() });
        else db.answers.push({ ...create, updatedAt: new Date() });
      },
    },
  },
}));
vi.mock("@/server/events", () => ({ audit: async (a: { action: string; params: Record<string, unknown> }) => void db.audits.push(a) }));
vi.mock("@/server/api-client", () => ({ apiFetch: async () => ({}) }));
vi.mock("@/server/modpack/manifest", () => ({ getManifest: async () => ({ mods: [] }), modBySlug: () => new Map() }));
vi.mock("@/server/announcements", () => ({ SYSTEM_AUTHOR: "system", newsImageUrl: (f: string | null) => (f ? `/news-image/${f}` : null) }));

describe("making a poll", () => {
  it("keeps 2 to 8 filled rows, numbers them, and adds 'I don't mind' last", () => {
    const r = makeOptions([{ text: "The Warden" }, { text: "" }, { text: " A Lava Golem ", link: "https://example.com/golem" }]);
    expect(r).toEqual({ ok: true, options: [{ id: "o1", text: "The Warden", image: null, link: null, modId: null }, { id: "o2", text: "A Lava Golem", image: null, link: "https://example.com/golem", modId: null }, { ...DONT_MIND }] });
    expect(makeOptions([{ text: "Only one" }]).ok).toBe(false);
    expect(makeOptions(Array.from({ length: 9 }, (_, i) => ({ text: `Option ${i}` }))).ok).toBe(false);
    expect(makeOptions([{ text: "A" }, { text: "a" }]).ok).toBe(false);
    expect(makeOptions([{ text: "A" }, { text: "I don't mind" }]).ok).toBe(false);
    expect(makeOptions([{ text: "A" }, { text: "B", link: "javascript:alert(1)" }]).ok).toBe(false);
  });
  it("never shows 'I don't mind' twice or anywhere but last, whatever was stored", () => {
    expect(readOptions([{ ...DONT_MIND }, { id: "o1", text: "A" }]).map((o) => o.id)).toEqual(["o1", "dont-mind"]);
  });
});

describe("the results", () => {
  const opts = readOptions([{ id: "o1", text: "The Warden" }, { id: "o2", text: "A Lava Golem" }]);
  it("counts votes per option, as a share of the members who voted", () => {
    const t = tallyPoll(opts, [{ choices: ["o1"] }, { choices: ["o1"] }, { choices: ["o2"] }, { choices: ["dont-mind"] }]);
    expect(t.counts.map((c) => [c.text, c.votes, c.percent])).toEqual([["The Warden", 2, 50], ["A Lava Golem", 1, 25], ["I don't mind", 1, 25]]);
    expect(resultLine(t)).toBe("The Warden");
  });
  it("calls a tie a tie, and 'I don't mind' never wins", () => {
    expect(resultLine(tallyPoll(opts, [{ choices: ["o1"] }, { choices: ["o2"] }]))).toBe("a tie between The Warden and A Lava Golem");
    expect(resultLine(tallyPoll(opts, [{ choices: ["dont-mind"] }]))).toBe("no clear answer");
  });
  it("posts the news in plain words when it opens and closes", () => {
    expect(openedNews("What's the next boss?", "4 Oct, 19:00", true)).toBe("New vote: What's the next boss? (open until 4 Oct, 19:00). Vote in Deepslate Works or on the site before your next game.");
    expect(closedNews("What's the next boss?", tallyPoll(opts, [{ choices: ["o2"] }]))).toBe("Vote closed: What's the next boss? Result: A Lava Golem (1 vote).");
  });
  it("asks the oldest first, and holds players but never admins", () => {
    const t = (h: number) => new Date(Date.UTC(2026, 9, 2, h));
    expect(pendingOrder([{ kind: "poll", id: "b", title: "B", openedAt: t(12) }, { kind: "ballot", id: "a", title: "A", openedAt: t(9) }]).map((p) => p.id)).toEqual(["a", "b"]);
    expect([voteHolds({ role: "PLAYER" }, 1), voteHolds({ role: "ADMIN" }, 1), voteHolds({ role: "PLAYER" }, 0)]).toEqual([true, false, false]);
  });
});

describe("voting", () => {
  const me = { id: "pabulum", role: "PLAYER" as const };
  beforeEach(() => {
    db.poll = { id: "p1", question: "Next boss", options: readOptions([{ id: "o1", text: "The Warden" }, { id: "o2", text: "A Lava Golem" }]), multiple: false, mustVote: true, status: "OPEN", openedAt: new Date(Date.now() - 60_000), closesAt: null, closedAt: null };
    db.answers = [];
    db.audits = [];
  });

  it("shows the results only after they have voted, and logs the vote without the choice in the line", async () => {
    const { answerPoll, getPoll } = await import("@/server/polls");
    expect((await getPoll("p1", me))?.results).toBeNull();
    const r = await answerPoll(me, "p1", ["o1"]);
    expect(r.ok && r.poll.results?.counts[0]?.votes).toBe(1);
    expect(r.ok && r.poll.mine).toEqual(["o1"]);
    expect(r.ok && r.poll.voters).toBeNull(); // who voted for what: admins only
    expect(db.audits).toEqual([{ userId: "pabulum", action: "poll.vote", params: { pollId: "p1", question: "Next boss", choices: ["The Warden"], changed: false }, result: "OK" }]);
  });

  it("lets them change their vote until the poll closes, and not after", async () => {
    const { answerPoll } = await import("@/server/polls");
    await answerPoll(me, "p1", ["o1"]);
    const changed = await answerPoll(me, "p1", ["o2"]);
    expect(changed.ok && changed.changed).toBe(true);
    expect(db.answers).toHaveLength(1);
    expect(db.answers[0]!.choices).toEqual(["o2"]);
    expect(db.audits.at(-1)?.params).toMatchObject({ changed: true, choices: ["A Lava Golem"] });
    db.poll!.status = "CLOSED";
    expect(await answerPoll(me, "p1", ["o1"])).toMatchObject({ ok: false, status: 409, code: "closed" });
    db.poll!.status = "OPEN";
    db.poll!.closesAt = new Date(Date.now() - 1000); // its date has passed, even before the api has marked it closed
    expect(await answerPoll(me, "p1", ["o1"])).toMatchObject({ ok: false, code: "closed" });
    expect(db.answers[0]!.choices).toEqual(["o2"]);
  });

  it("refuses an answer the poll doesn't have", async () => {
    const { answerPoll } = await import("@/server/polls");
    expect(await answerPoll(me, "p1", ["o1", "o2"])).toMatchObject({ ok: false, code: "bad_choice" });
    expect(await answerPoll(me, "p1", "nonsense")).toMatchObject({ ok: false, code: "bad_choice" });
  });

  it("shows admins who voted for what", async () => {
    const { answerPoll, getPoll } = await import("@/server/polls");
    await answerPoll(me, "p1", ["o2"]);
    const v = await getPoll("p1", { id: "alex", role: "ADMIN" });
    expect(v?.voters?.map((x) => [x.name, x.choices])).toEqual([["pabulum", ["o2"]]]);
    expect(v?.results?.voters).toBe(1);
  });
});
