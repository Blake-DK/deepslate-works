import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "../src/events/parse.js";
import type { NewEvent } from "../src/events/recorder.js";
import { advancementKey, doneAt, gameTime } from "../src/seasons/advancements.js";
import { currentSeasonId, readSeasonFile } from "../src/seasons/files.js";
import { SeasonRecorder } from "../src/seasons/recorder.js";
import { memorySeasonStore, type SeasonRow } from "../src/seasons/store.js";
import { findByTitle, goalMarks, nextUp, scoreboard, seasonClock, seasonCurrent, seasonLine, seasonResult, ukDay, type Clear, type SeasonFile } from "../src/shared/season.js";

// docs/34 §4 (W1.3): the season's recording. The season is the sample file as it is in the repo, so this also shows
// that api reads what packages/modpack lints.

/** A line as the server really prints it (the form parse.test.ts holds). */
const L = (msg: string) => `[29Sep2026 03:46:07.132] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: ${msg}`;
const DIR = fileURLToPath(new URL("../../../modpack/seasons", import.meta.url));
const U = { anna: "11111111-1111-4111-8111-111111111111", ben: "22222222-2222-4222-8222-222222222222", cy: "33333333-3333-4333-8333-333333333333" };
const members = [
  { mcUuid: U.anna, mcName: "Anna", userId: "u-anna" },
  { mcUuid: U.ben, mcName: "Ben", userId: "u-ben" },
  { mcUuid: U.cy, mcName: "Cy", userId: "u-cy" },
];

async function sample(): Promise<SeasonFile> {
  const s = await readSeasonFile(DIR, "sample");
  if (!s) throw new Error("modpack/seasons/sample.json does not read");
  return s;
}

const row = (s: SeasonFile, state: SeasonRow["state"]): SeasonRow => ({ id: s.id, name: s.name, startsAt: new Date(s.startsAt), endsAt: new Date(s.endsAt), state, marks: {}, result: null });

async function setup(state: SeasonRow["state"] = "running", at = "2026-11-24T20:00:00Z") {
  const file = await sample();
  const store = memorySeasonStore([row(file, state)], members);
  const events: NewEvent[] = [];
  const timers: Array<() => void> = [];
  const clock = { now: new Date(at) };
  const files = new Map<string, unknown>();
  const rec = new SeasonRecorder({
    file: async () => file,
    store,
    uuidOf: async (name) => members.find((m) => m.mcName === name)?.mcUuid ?? null,
    addEvent: async (e) => void events.push(e),
    advancements: async () => async (uuid) => files.get(uuid) ?? null,
    log: () => {},
    now: () => clock.now,
    later: (fn) => void timers.push(fn),
  });
  /** A line as the server prints it, through the same parser the console tail uses. */
  const say = (name: string, how: string, title: string) => {
    for (const e of parse(L(`${name} has ${how} [${title}]`))) rec.onConsole(e, { replay: false });
  };
  const flush = async () => {
    await rec.idle();
    for (const t of timers.splice(0)) t();
    await rec.idle();
  };
  return { file, store, events, rec, say, flush, clock, files, timers };
}

describe("the season files, as api reads them", () => {
  it("reads the sample and the real Season 1, and the index", async () => {
    const s = await sample();
    expect(s.bosses.map((b) => b.id)).toEqual(["rehearsal_ravager", "rehearsal_golem"]);
    const s1 = await readSeasonFile(DIR, "s1");
    expect(s1?.bosses.length).toBeGreaterThan(5);
    expect(s1?.finale?.boss).toBe("ender_dragon");
    expect(await currentSeasonId(DIR)).toBe("s1");
    expect(await readSeasonFile(DIR, "../mods")).toBeNull();
    expect(await readSeasonFile(DIR, "nope")).toBeNull();
  });

  it("a title says which boss or trial it was, or that a boss was woken", async () => {
    const s = await sample();
    expect(findByTitle(s, "The Rehearsal Ravager")).toMatchObject({ kind: "boss", id: "rehearsal_ravager" });
    expect(findByTitle(s, "Woke The Rehearsal Golem")).toMatchObject({ kind: "wake", id: "rehearsal_golem" });
    expect(findByTitle(s, "Rehearsal: The Bed")).toMatchObject({ kind: "trial", id: "rehearsal_bed" });
    expect(findByTitle(s, "Stone Age")).toBeNull();
  });
});

describe("the season recorder", () => {
  it("a group's kill within the five seconds is one event, and all of them are first", async () => {
    const t = await setup();
    t.say("Anna", "completed the challenge", "The Rehearsal Ravager");
    t.say("Ben", "completed the challenge", "The Rehearsal Ravager");
    await t.rec.idle();
    expect(t.store.rows).toHaveLength(0); // still waiting for the group
    expect(t.timers).toHaveLength(1);
    await t.flush();
    expect(t.store.rows.map((r) => [r.mcName, r.first, r.source, r.userId])).toEqual([["Anna", true, "console", "u-anna"], ["Ben", true, "console", "u-ben"]]);
    const fell = t.events.filter((e) => (e.meta as { what?: string }).what === "boss");
    expect(fell).toHaveLength(1);
    expect(fell[0]).toMatchObject({ kind: "SEASON", actor: U.anna, message: "The Rehearsal Ravager has fallen for the first time, to Anna and Ben" });
    expect(fell[0]!.meta).toMatchObject({ season: "sample", id: "rehearsal_ravager", first: true, names: ["Anna", "Ben"] });
  });

  it("a later kill is not first, and the same player's second line adds nothing", async () => {
    const t = await setup();
    t.say("Anna", "completed the challenge", "The Rehearsal Ravager");
    await t.flush();
    t.say("Cy", "completed the challenge", "The Rehearsal Ravager");
    t.say("Anna", "completed the challenge", "The Rehearsal Ravager");
    await t.flush();
    expect(t.store.rows.map((r) => [r.mcName, r.first])).toEqual([["Anna", true], ["Cy", false]]);
    expect(t.events.map((e) => e.message)).toContain("Cy defeated The Rehearsal Ravager");
  });

  it("first is the store's to decide: of two clears of one thing at the same moment only one is first", async () => {
    const file = await sample();
    const store = memorySeasonStore([row(file, "running")], members);
    const clear = (m: (typeof members)[number]) => ({ kind: "trial" as const, itemId: "rehearsal_table", mcUuid: m.mcUuid, mcName: m.mcName, userId: m.userId, at: new Date("2026-11-20T10:00:00Z"), early: false, source: "console" as const });
    const [a, b] = await Promise.all([store.addClears("sample", [clear(members[0]!)]), store.addClears("sample", [clear(members[1]!)])]);
    expect([a.first, b.first].filter(Boolean)).toHaveLength(1);
  });

  it("a wake title makes a line and no clear, once in fifteen minutes", async () => {
    const t = await setup();
    t.say("Anna", "made the advancement", "Woke The Rehearsal Golem");
    t.say("Ben", "made the advancement", "Woke The Rehearsal Golem");
    await t.flush();
    expect(t.store.rows).toHaveLength(0);
    expect(t.events.map((e) => e.message)).toEqual(["The Rehearsal Golem has awoken"]);
    t.clock.now = new Date(t.clock.now.getTime() + 16 * 60_000);
    t.say("Ben", "made the advancement", "Woke The Rehearsal Golem");
    await t.flush();
    expect(t.events).toHaveLength(2);
  });

  it("records nothing before the season is started or after it has ended, and nothing for other advancements", async () => {
    for (const state of ["upcoming", "ended"] as const) {
      const t = await setup(state);
      t.say("Anna", "completed the challenge", "The Rehearsal Ravager");
      t.say("Anna", "made the advancement", "Woke The Rehearsal Golem");
      await t.flush();
      expect(t.store.rows).toHaveLength(0);
      expect(t.events).toHaveLength(0);
    }
    const t = await setup();
    t.say("Anna", "made the advancement", "Stone Age");
    await t.flush();
    expect(t.events).toHaveLength(0);
  });

  it("old lines read again after a restart are left to the safety net", async () => {
    const t = await setup();
    for (const e of parse(L("Anna has completed the challenge [The Rehearsal Ravager]"))) t.rec.onConsole(e, { replay: true });
    await t.flush();
    expect(t.store.rows).toHaveLength(0);
  });

  it("a boss killed before it opened counts, as found early", async () => {
    const t = await setup("running", "2026-11-20T20:00:00Z"); // the golem opens on the 23rd
    t.say("Anna", "completed the challenge", "The Rehearsal Golem");
    await t.flush();
    expect(t.store.rows[0]).toMatchObject({ early: true, first: true });
    expect(t.events[0]!.message).toBe("The Rehearsal Golem has fallen for the first time, to Anna (found early)");
  });

  it("names a new leader, and not again within a day", async () => {
    const t = await setup();
    t.say("Anna", "completed the challenge", "The Rehearsal Ravager");
    await t.flush();
    expect(t.events.map((e) => e.message)).toContain("Anna leads the season with 20 points");
    t.say("Ben", "completed the challenge", "The Rehearsal Golem");
    await t.flush();
    expect(t.events.filter((e) => (e.meta as { what?: string }).what === "leader")).toHaveLength(1); // Ben has 30, but a day has not passed
    t.clock.now = new Date(t.clock.now.getTime() + 25 * 3_600_000);
    t.say("Ben", "made the advancement", "Rehearsal: The Table");
    await t.flush();
    expect(t.events.at(-1)!.message).toBe("Ben leads the season with 40 points");
  });
});

describe("the safety net: the players' advancement files", () => {
  it("reads the game's time and whether an advancement is done", () => {
    expect(gameTime("2026-11-24 19:22:11 +0000")?.toISOString()).toBe("2026-11-24T19:22:11.000Z");
    expect(gameTime("2026-06-01 20:00:00 +0100")?.toISOString()).toBe("2026-06-01T19:00:00.000Z");
    expect(gameTime("yesterday")).toBeNull();
    const file = { "deepslate:sample/boss/rehearsal_ravager": { criteria: { kill: "2026-11-24 19:22:11 +0000" }, done: true }, "deepslate:sample/trial/rehearsal_bed": { criteria: {}, done: false }, DataVersion: 3955 };
    expect(doneAt(file, advancementKey("sample", "boss", "rehearsal_ravager"))?.toISOString()).toBe("2026-11-24T19:22:11.000Z");
    expect(doneAt(file, advancementKey("sample", "trial", "rehearsal_bed"))).toBeNull();
    expect(doneAt(file, "deepslate:sample/boss/none")).toBeNull();
    expect(doneAt(null, "x")).toBeNull();
  });

  it("adds a clear the console never gave, with the game's time, and leaves what is there alone", async () => {
    const t = await setup();
    t.say("Anna", "completed the challenge", "The Rehearsal Ravager");
    await t.flush();
    const before = t.events.length;
    t.files.set(U.anna, { "deepslate:sample/boss/rehearsal_ravager": { criteria: { kill: "2026-11-24 19:59:58 +0000" }, done: true } });
    t.files.set(U.ben, {
      "deepslate:sample/boss/rehearsal_ravager": { criteria: { kill: "2026-11-24 19:59:58 +0000" }, done: true },
      "deepslate:sample/trial/rehearsal_table": { criteria: { done: "2026-11-10 12:00:00 +0000" }, done: true }, // before the season: not recorded
    });
    await t.rec.fromFiles();
    expect(t.store.rows.map((r) => [r.mcName, r.itemId, r.source, r.first])).toEqual([["Anna", "rehearsal_ravager", "console", true], ["Ben", "rehearsal_ravager", "file", false]]);
    expect(t.store.rows[1]!.at.toISOString()).toBe("2026-11-24T19:59:58.000Z");
    expect(t.events.slice(before).map((e) => e.message)).toContain("Ben defeated The Rehearsal Ravager");
    const again = t.events.length;
    await t.rec.fromFiles();
    expect(t.events).toHaveLength(again);
  });
});

describe("the season's clock", () => {
  it("says a trial and a boss that have just opened once, and nothing that opened long ago", async () => {
    const t = await setup("running", "2026-11-23T19:00:30Z");
    await t.rec.tick();
    expect(t.events.map((e) => e.message).sort()).toEqual(["A new trial is open: Rehearsal: The Bed. Sleep in a bed.", "The Rehearsal Golem joins the ladder. Any village, or summoned"].sort());
    await t.rec.tick();
    expect(t.events).toHaveLength(2); // the table trial opened a week ago: marked, not said
    expect(t.store.seasons[0]!.marks.done).toEqual(expect.arrayContaining(["trial:rehearsal_table", "trial:rehearsal_bed", "boss:rehearsal_golem", "week_to_go"]));
  });

  it("does nothing for a season that is not running", async () => {
    const t = await setup("upcoming", "2026-11-23T19:00:30Z");
    await t.rec.tick();
    expect(t.events).toHaveLength(0);
  });
});

describe("weeks, days and the scoreboard", () => {
  const s1: SeasonFile = { id: "s1", name: "Season 1", startsAt: "2026-11-30T19:00:00Z", endsAt: "2026-12-28T19:00:00Z", icon: "minecraft:netherite_sword", bosses: [{ id: "a", title: "A Boss", entity: "", tier: 1, points: 10, where: "", hint: "" }], trials: [{ id: "t", title: "A Trial", opensAt: "2026-12-04T19:00:00Z", points: 5, solo: true, hint: "Do it.", icon: "minecraft:paper" }], goal: { title: "4 boss kills between us", count: "boss_kills", target: 4 }, finale: { at: "2026-12-26T20:00:00Z", title: "The Dragon, together", boss: "a" } };

  it("counts weeks from the opening Monday by the UK's calendar", () => {
    expect(seasonClock(s1, new Date("2026-11-30T19:00:00Z"))).toEqual({ week: 1, weeks: 4, daysLeft: 28 });
    expect(seasonClock(s1, new Date("2026-12-06T23:59:00Z"))).toMatchObject({ week: 1, daysLeft: 22 });
    expect(seasonClock(s1, new Date("2026-12-07T00:01:00Z"))).toMatchObject({ week: 2, daysLeft: 21 });
    expect(seasonClock(s1, new Date("2026-12-28T12:00:00Z"))).toMatchObject({ week: 4, daysLeft: 0 });
  });

  it("is not thrown by the clocks changing: a season across 25 October 2026 and one across 28 March 2027", () => {
    const autumn: SeasonFile = { ...s1, startsAt: "2026-10-19T18:00:00Z", endsAt: "2026-11-02T19:00:00Z" };
    expect(seasonClock(autumn, new Date("2026-10-25T23:30:00Z"))).toEqual({ week: 1, weeks: 2, daysLeft: 8 }); // 23:30 GMT on the Sunday
    expect(seasonClock(autumn, new Date("2026-10-26T00:30:00Z"))).toEqual({ week: 2, weeks: 2, daysLeft: 7 });
    const spring: SeasonFile = { ...s1, startsAt: "2027-03-22T19:00:00Z", endsAt: "2027-04-05T18:00:00Z" };
    expect(seasonClock(spring, new Date("2027-03-28T23:30:00Z"))).toMatchObject({ week: 2 }); // already Monday 00:30 in the UK
    expect(ukDay(new Date("2027-03-28T23:30:00Z")) - ukDay(new Date("2027-03-28T22:30:00Z"))).toBe(1);
  });

  it("current, in each state", () => {
    const at = (iso: string) => iso.slice(0, 10);
    expect(seasonCurrent(null, null, new Date())).toEqual({ state: "none" });
    expect(seasonCurrent(s1, null, new Date())).toEqual({ state: "none" });
    const up = seasonCurrent(s1, "upcoming", new Date("2026-11-20T12:00:00Z"));
    expect(seasonLine(up, at)).toBe("Season 1 opens 2026-11-30.");
    const run = seasonCurrent(s1, "running", new Date("2026-12-05T12:00:00Z"));
    expect(run).toMatchObject({ state: "running", week: 1, weeks: 4, daysLeft: 23, thisWeek: { trial: { id: "t" } }, next: { kind: "finale" } });
    expect(seasonLine(run, at)).toBe("Season 1 · week 1 of 4, 23 days left. This week's trial: A Trial. Next: the finale, 2026-12-26.");
    expect(nextUp(s1, new Date("2026-12-27T12:00:00Z"))).toMatchObject({ kind: "end" });
    const over = seasonCurrent(s1, "ended", new Date("2026-12-29T12:00:00Z"));
    expect(over).toMatchObject({ state: "ended", next: null });
    expect(seasonLine(over, at)).toMatch(/is over/);
    expect(seasonLine({ state: "none" }, at)).toBeNull();
  });

  it("points per the file, twice for the first, and the frozen result", () => {
    const c = (name: string, kind: Clear["kind"], itemId: string, first: boolean, at: string): Clear => ({ kind, itemId, mcUuid: name, mcName: name, at: new Date(at), first, early: false });
    const clears = [c("Anna", "boss", "a", true, "2026-12-01T20:00:00Z"), c("Ben", "boss", "a", false, "2026-12-02T20:00:00Z"), c("Ben", "trial", "t", true, "2026-12-05T20:00:00Z"), c("Cy", "boss", "gone", true, "2026-12-05T21:00:00Z")];
    const board = scoreboard(s1, clears);
    expect(board.map((r) => [r.mcName, r.points, r.bosses, r.trials, r.firsts])).toEqual([["Anna", 20, 1, 0, 1], ["Ben", 20, 1, 1, 1]]); // level: Anna got there sooner
    expect(goalMarks(50)).toEqual([25, 50]);
    const result = seasonResult(s1, clears, new Date("2026-12-28T19:00:00Z"));
    expect(result.goal).toMatchObject({ count: 2, target: 4, percent: 50 });
    expect(result.firsts.map((f) => [f.title, f.names])).toEqual([["A Boss", ["Anna"]], ["A Trial", ["Ben"]]]);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
