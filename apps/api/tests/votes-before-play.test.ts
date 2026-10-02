import { beforeEach, describe, expect, it, vi } from "vitest";
import { actions, parsePlace, pollChat, screenText, voteTellraw } from "../src/actions/registry.js";
import { doorReason, waitFor } from "../src/players/limbo.js";
import { doorRule } from "../src/shared/access.js";
import { describeAction, kindOf } from "../src/shared/events.js";
import { checkChoices, dueToClose, isOpen, VOTE_FIRST_TEXT } from "../src/shared/polls.js";
import { PLAY_MODES } from "../src/shared/join-gate.js";

// Planner 2026-10-02, "votes before play". The door's order becomes linked → open for them → must-vote polls answered
// → Play first → in. A member with an open must-vote poll they have not answered waits in the room ("There's a new
// vote…", title and a chat line every 15 s) and is let in within seconds of voting. A poll that opens while someone
// plays never holds or kicks them; admins are asked but never held; a closed poll no longer counts.

const state = vi.hoisted(() => ({
  unvoted: 0,
  role: "PLAYER" as "PLAYER" | "ADMIN",
  ran: [] as Array<{ name: string; input: unknown }>,
  audits: [] as Array<{ action: string; params: Record<string, unknown> }>,
  polls: [] as Array<{ id: string; question: string; options: unknown; status: "OPEN" | "CLOSED"; mustVote: boolean; closesAt: Date | null; answers: Array<{ userId: string; choices: string[] }> }>,
  news: [] as string[],
}));

vi.mock("../src/actions/run.js", () => ({
  runAction: async (_amp: unknown, _ctx: unknown, name: string, input: unknown) => {
    state.ran.push({ name, input });
    return { ok: true, commands: 1 };
  },
}));
vi.mock("../src/audit.js", () => ({ audit: async (a: { action: string; params: Record<string, unknown> }) => void state.audits.push(a) }));
vi.mock("../src/settings.js", () => ({ getSection: async (k: string) => (k === "joining" ? { requirePlay: true, windowMin: 30, minInstaller: "1.5.0" } : { name: "Deepslate Works", tagline: "" }) }));
vi.mock("../src/players/pack.js", () => ({ serverPack: async () => "0.1.0+43978c76" }));
vi.mock("../src/players/mods.js", () => ({ modsMissingFor: async () => false }));
vi.mock("../src/db.js", () => {
  const openNow = (p: (typeof state.polls)[number], now: Date) => p.status === "OPEN" && (!p.closesAt || p.closesAt > now);
  return {
    db: {
      user: {
        findFirst: async () => ({ id: "u1", role: state.role, earlyAccess: true, verifiedAt: new Date(), guildMember: true, mcUsername: "pabulum" }),
        findUnique: async () => ({ id: "u1", role: state.role, earlyAccess: true }),
        update: async () => ({}),
      },
      siteSettings: { findUnique: async () => ({ live: false }) },
      // a run of Play a minute ago, with the server's pack: Play first is met
      installReport: { findFirst: async () => ({ at: new Date(Date.now() - 60_000), packVersion: "0.1.0+43978c76", installerVersion: "3.2.0" }) },
      poll: {
        // what unvotedFor asks: open, must vote, not past its date, no answer from them
        count: async ({ where }: { where: { answers: { none: { userId: string } }; OR: Array<{ closesAt: unknown }> } }) => {
          const now = new Date();
          return state.polls.filter((p) => p.mustVote && openNow(p, now) && !p.answers.some((a) => a.userId === where.answers.none.userId)).length;
        },
        findMany: async () => state.polls.filter((p) => p.status === "OPEN" && p.closesAt && p.closesAt <= new Date()).map((p) => ({ id: p.id })),
        updateMany: async ({ where, data }: { where: { id: string; status: string }; data: { status: "CLOSED" } }) => {
          const p = state.polls.find((x) => x.id === where.id && x.status === where.status);
          if (!p) return { count: 0 };
          p.status = data.status;
          return { count: 1 };
        },
        findUnique: async ({ where }: { where: { id: string } }) => state.polls.find((p) => p.id === where.id) ?? null,
      },
      vote: { count: async () => 0 },
      announcement: { create: async ({ data }: { data: { body: string } }) => void state.news.push(data.body) },
    },
  };
});

const PACK = "0.1.0+43978c76";
const now = new Date("2026-10-02T12:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);
const run = (min: number) => ({ at: ago(min), packVersion: PACK, installerVersion: "3.2.0" });
const player = { role: "PLAYER" as const, earlyAccess: false };
const early = { role: "PLAYER" as const, earlyAccess: true };
const admin = { role: "ADMIN" as const, earlyAccess: false };
const ctx = { limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: null, portalUrl: "https://deepslate.dsw.test" };

describe("the door, in its new order: linked → open for them → votes answered → Play first → in", () => {
  it.each([
    // who, live, Play first, their latest run that went through, unanswered must-vote polls, at the door
    ["player, not live", player, false, true, run(5), 1, "not live"], // open first, whatever else
    ["early access, one vote open", early, false, true, run(5), 1, "vote"],
    ["early access, two votes open", early, false, true, run(5), 2, "vote"],
    ["early access, voted", early, false, true, run(5), 0, null],
    ["player, live, vote before Play first", player, true, true, null, 1, "vote"], // the vote is asked before Play
    ["player, live, voted, no Play", player, true, true, null, 0, "no report"],
    ["player, live, voted, stale Play", player, true, true, run(45), 0, "stale"],
    ["player, live, Play first off, vote open", player, true, false, null, 1, "vote"], // must-vote holds even without Play first
    ["player, live, Play first off, voted", player, true, false, null, 0, null],
    ["admin, vote open", admin, false, true, null, 3, null], // asked like everyone else, never held
    ["admin, live, vote open", admin, true, true, run(5), 1, null],
    // app 3.3.0: the Update button's report ("update_only") counts like Play or an install (atTheDoor reads PLAY_MODES)
    ["Player, live, vote 0, last report Update and fresh", player, true, true, run(8), 0, null],
  ] as const)("%s", (_who, user, live, requirePlay, r, unvoted, expected) => {
    expect(doorReason(user, { live, requirePlay, windowMin: 30, run: r, pack: PACK, now, minInstaller: "1.5.0", unvoted })).toBe(expected);
  });

  it("takes the Update button's report as the latest run that went through", () => {
    expect(PLAY_MODES as readonly string[]).toContain("update_only");
  });

  it("is the same rule as the shared doorRule", () => {
    expect(doorRule(early, { live: false, requirePlay: true, hasPlayed: true, unvoted: 1 })).toBe("vote first");
    expect(doorRule(early, { live: false, requirePlay: true, hasPlayed: false, unvoted: 0 })).toBe("play first");
    expect(doorRule(player, { live: false, requirePlay: true, hasPlayed: true, unvoted: 1 })).toBe("not open");
    expect(doorRule(admin, { live: false, requirePlay: true, hasPlayed: false, unvoted: 5 })).toBe("in");
  });

  it("says so in the room: a title that stays, and the planner's line in chat with the site as a link", () => {
    expect(waitFor("vote")).toBe("vote");
    expect(screenText("vote", ctx.portalUrl)).toEqual({ title: "There's a new vote", subtitle: "Open Deepslate Works or deepslate.dsw.test to vote, then you're in" });
    const cmds = actions["limbo.holdVote"].build(ctx, { name: "pabulum" });
    expect(cmds).toContain("execute in deepslate:limbo run tp pabulum 0.5 65 0.5");
    expect(cmds).toContain('title @a[name=pabulum,tag=!verified] title {"text":"There\'s a new vote","color":"gold"}');
    const chat = JSON.parse(voteTellraw("pabulum", ctx.portalUrl).replace(/^tellraw pabulum /, "")) as Array<string | { text: string }>;
    expect(chat.map((p) => (typeof p === "string" ? p : p.text)).join("")).toBe("There's a new vote. Open Deepslate Works or deepslate.dsw.test to vote, then you're in.");
    expect(VOTE_FIRST_TEXT("deepslate.dsw.test")).toBe("There's a new vote. Open Deepslate Works or deepslate.dsw.test to vote, then you're in.");
    expect(actions["limbo.remindVote"].build(ctx, { name: "pabulum" })).toEqual(cmds.slice(-5));
    expect(actions["limbo.kickIdleVote"].build(ctx, { name: "pabulum" })).toEqual(["kick pabulum There's a new vote. Open Deepslate Works or deepslate.dsw.test to vote, then you're in."]);
  });

  it("is in the event log", () => {
    expect(kindOf("join.blocked", "PLAYER")).toBe("JOIN_BLOCKED");
    expect(describeAction("join.blocked", { role: "PLAYER", name: "Pabulum" }, { name: "pabulum", reason: "vote" })).toBe("Pabulum was held in the entrance room: they have not answered the new vote yet");
    expect(describeAction("join.ready", { role: "PLAYER", name: "Pabulum" }, { name: "pabulum", was: "vote", back: true })).toBe("Pabulum voted and was let in, back to where they were");
    expect(kindOf("limbo.kickIdleVote", "system")).toBe("LINK");
    expect(describeAction("poll.vote", { role: "PLAYER", name: "Pabulum" }, { question: "Next boss", choices: ["The Warden"] })).toBe('Pabulum voted in "Next boss"'); // the choice stays in meta, for admins
    expect(describeAction("poll.vote", { role: "PLAYER", name: "Pabulum" }, { question: "Next boss", changed: true })).toBe('Pabulum changed their vote in "Next boss"');
    expect(describeAction("server.wake", { role: "PLAYER", name: "Pabulum" }, { name: "Pabulum", via: "app" })).toBe("Pabulum woke the server (app)");
    expect(describeAction("server.wake", { role: "PLAYER", name: "Pabulum" }, { name: "Pabulum" })).toBe("Pabulum woke the server (Play)");
  });
});

async function room() {
  const { Limbo } = await import("../src/players/limbo.js");
  const tail = { online: new Set(["pabulum"]), uuidByName: new Map([["pabulum", "uuid-p"]]), state: 20, on() {}, onResync() {} };
  const env = { LIMBO_POS: "deepslate:limbo 0.5 65 0.5", SPAWN_POS: "", PORTAL_URL: "https://deepslate.dsw.test" } as never;
  const limbo = new Limbo(env, {} as never, tail as never, () => {});
  (limbo as unknown as { where: () => Promise<null> }).where = async () => null; // nobody to ask in a test
  return { limbo, tick: () => (limbo as unknown as { tick: () => Promise<void> }).tick() };
}
const names = () => state.ran.map((r) => r.name).filter((n) => n !== "server.welcome" && n !== "limbo.keep" && n !== "limbo.bar");
const poll = (id: string, extra: Partial<(typeof state.polls)[number]> = {}) => ({ id, question: "What's the next boss?", options: [{ id: "o1", text: "The Warden" }, { id: "o2", text: "A Lava Golem" }], status: "OPEN" as const, mustVote: true, closesAt: null, answers: [], ...extra });

describe("in the room", () => {
  beforeEach(() => {
    state.ran = [];
    state.audits = [];
    state.polls = [];
    state.news = [];
    state.role = "PLAYER";
  });

  it("holds a member with an unanswered must-vote poll, and lets them in within one round of voting", async () => {
    const { unvotedFor } = await import("../src/players/polls.js");
    state.polls = [poll("p1")];
    expect(await unvotedFor("u1")).toBe(1);
    const { limbo, tick } = await room();
    await limbo.onJoin("pabulum");
    expect(names()).toEqual(["limbo.holdVote"]);
    expect(limbo.held.get("pabulum")?.kind).toBe("vote");
    expect(state.audits.at(-1)).toMatchObject({ action: "join.blocked", params: { reason: "vote" } });
    state.ran = [];
    await tick(); // still not voted: they stay
    expect(limbo.held.has("pabulum")).toBe(true);
    state.polls[0]!.answers.push({ userId: "u1", choices: ["o1"] }); // they vote in the app
    await tick(); // the next round, within 5 s
    expect(names()).toEqual(["limbo.releaseBack"]);
    expect(limbo.held.has("pabulum")).toBe(false);
    expect(state.audits.at(-1)).toMatchObject({ action: "join.ready", params: { was: "vote" } });
  });

  it("never holds an admin, who is asked like everyone else", async () => {
    state.role = "ADMIN";
    state.polls = [poll("p1")];
    const { limbo } = await room();
    await limbo.onJoin("pabulum");
    expect(names()).toEqual(["link.release"]);
    expect(limbo.held.size).toBe(0);
  });

  it("does not hold or kick someone already playing when a poll opens: one chat line, and it applies from their next join", async () => {
    const { limbo, tick } = await room();
    await limbo.onJoin("pabulum"); // in, nothing open
    expect(names()).toEqual(["link.release"]);
    state.ran = [];
    state.polls = [poll("p1")]; // an admin opens a must-vote poll now
    await tick();
    await limbo.onEvent({ type: "chat", name: "pabulum", text: "a new vote?" });
    expect(names()).toEqual([]); // nothing done to them
    expect(limbo.held.size).toBe(0);
    const line = actions["server.pollOpened"].build(ctx, { question: "What's the next boss?" });
    expect(line).toEqual([pollChat("What's the next boss?", ctx.portalUrl)]);
    expect(line[0]).toMatch(/^tellraw @a\[tag=verified\] /); // whoever is in the world, never the room
    expect(line[0]).not.toMatch(/kick|tp /);
    await limbo.onEvent({ type: "leave", name: "pabulum" });
    await limbo.onJoin("pabulum"); // the next join
    expect(names()).toEqual(["limbo.holdVote"]);
  });

  it("no longer counts a poll once it has closed, by an admin or at its date", async () => {
    const { unvotedFor, closeDuePolls } = await import("../src/players/polls.js");
    state.polls = [poll("p1", { status: "CLOSED" }), poll("p2", { closesAt: new Date(Date.now() - 1000) })];
    expect(await unvotedFor("u1")).toBe(0); // closed, and past its date
    expect(await closeDuePolls()).toBe(1); // p2 is closed now, once, with its result on the news
    expect(await closeDuePolls()).toBe(0);
    expect(state.news).toEqual(["Vote closed: What's the next boss? Result: no clear answer (0 votes)."]);
    expect(state.audits.at(-1)).toMatchObject({ action: "poll.close", params: { auto: true } });
    const { limbo } = await room();
    await limbo.onJoin("pabulum");
    expect(names()).toEqual(["link.release"]);
  });

  it("does not count a poll that isn't must-vote", async () => {
    const { unvotedFor } = await import("../src/players/polls.js");
    state.polls = [poll("p1", { mustVote: false })];
    expect(await unvotedFor("u1")).toBe(0);
  });
});

describe("the poll itself", () => {
  const p = { options: [{ id: "o1", text: "The Warden" }, { id: "o2", text: "A Lava Golem" }], multiple: false };
  it("takes one option, or several with multiple choice, and 'I don't mind' only on its own", () => {
    expect(checkChoices(p, ["o1"])).toEqual({ ok: true, choices: ["o1"] });
    expect(checkChoices(p, ["o1", "o2"]).ok).toBe(false);
    expect(checkChoices({ ...p, multiple: true }, ["o1", "o2"])).toEqual({ ok: true, choices: ["o1", "o2"] });
    expect(checkChoices({ ...p, multiple: true }, ["o1", "dont-mind"]).ok).toBe(false);
    expect(checkChoices(p, ["dont-mind"])).toEqual({ ok: true, choices: ["dont-mind"] });
    expect(checkChoices(p, ["o9"]).ok).toBe(false);
    expect(checkChoices(p, []).ok).toBe(false);
  });
  it("is open until it is closed or its date passes", () => {
    expect(isOpen({ status: "OPEN", closesAt: null }, now)).toBe(true);
    expect(isOpen({ status: "OPEN", closesAt: ago(-1) }, now)).toBe(true);
    expect(isOpen({ status: "OPEN", closesAt: ago(1) }, now)).toBe(false);
    expect(isOpen({ status: "CLOSED", closesAt: null }, now)).toBe(false);
    expect(dueToClose({ status: "OPEN", closesAt: ago(1) }, now)).toBe(true);
    expect(dueToClose({ status: "CLOSED", closesAt: ago(1) }, now)).toBe(false);
  });
});
