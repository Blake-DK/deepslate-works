import { beforeEach, describe, expect, it, vi } from "vitest";
import { actions, linkTellraw, parsePlace, screenCommands, screenText } from "../src/actions/registry.js";
import { CODE_ALPHABET, CODE_RE, CODE_TTL_MS, codeUsable, makeCode, readCode, showCode } from "../src/shared/join-code.js";

// docs/14 "The prompt" (planner, 2026-09-29): people missed the one link line and could not get it back. The line
// now comes every 15 s and whenever they say something; a title stays on screen; a 6-character code works on /join.

const codes = vi.hoisted(() => ({ rows: [] as Array<{ code: string; mcUuid: string; mcUsername: string; expiresAt: Date; usedById: string | null; createdAt: Date }> }));
vi.mock("../src/db.js", () => ({
  db: {
    linkCode: {
      updateMany: async ({ where, data }: { where: { mcUuid: string; expiresAt: { gt: Date } }; data: { expiresAt: Date } }) => {
        let count = 0;
        for (const r of codes.rows) if (r.mcUuid === where.mcUuid && !r.usedById && r.expiresAt > where.expiresAt.gt) { r.expiresAt = data.expiresAt; count++; }
        return { count };
      },
      findFirst: async ({ where }: { where: { mcUuid: string; expiresAt: { gt: Date } } }) =>
        codes.rows.filter((r) => r.mcUuid === where.mcUuid && !r.usedById && r.expiresAt > where.expiresAt.gt).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
      findUnique: async ({ where }: { where: { code: string } }) => codes.rows.find((r) => r.code === where.code) ?? null,
      create: async ({ data }: { data: { code: string; mcUuid: string; mcUsername: string; expiresAt: Date } }) => {
        const row = { ...data, usedById: null, createdAt: new Date() };
        codes.rows.push(row);
        return row;
      },
    },
  },
}));

const URL_ = "https://deepslate.dsw.test";
const ctx = { limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: null, portalUrl: URL_ };

async function room() {
  const { Limbo } = await import("../src/players/limbo.js");
  const tail = { online: new Set(["pabulum"]), uuidByName: new Map([["pabulum", "uuid-p"]]), state: 20, on() {}, onResync() {} };
  const env = { LIMBO_POS: "deepslate:limbo 0.5 65 0.5", SPAWN_POS: "", PORTAL_URL: URL_ } as never;
  const limbo = new Limbo(env, {} as never, tail as never, () => {});
  const sent: number[] = [];
  (limbo as unknown as { prompt: (n: string, h: { lastReminder: number }, now: number) => Promise<void> }).prompt = async (_n, h, now) => {
    h.lastReminder = now;
    sent.push(now);
  };
  return { limbo, sent, tail };
}

describe("the prompt, again and again", () => {
  const T0 = 1_790_000_000_000;

  it("goes every 15 seconds while they are held, never sooner", async () => {
    const { limbo, sent } = await room();
    limbo.held.set("pabulum", { uuid: "uuid-p", code: "ABC234", since: T0, lastReminder: T0, kind: "link" }); // the hold itself prompted at 0 s
    for (let t = 0; t <= 46_000; t += 1000) await limbo.promptRound(T0 + t); // the timer runs every second
    expect(sent.map((t) => t - T0)).toEqual([15_000, 30_000, 45_000]);
  });

  it("goes at once when they say anything, and the 15 seconds start from there", async () => {
    const { limbo, sent } = await room();
    limbo.held.set("pabulum", { uuid: "uuid-p", code: "ABC234", since: T0, lastReminder: T0, kind: "link" });
    vi.spyOn(Date, "now").mockReturnValue(T0 + 7_000);
    await limbo.onEvent({ type: "chat", name: "pabulum", text: "how do I get in?" });
    vi.restoreAllMocks();
    expect(sent.map((t) => t - T0)).toEqual([7_000]);
    for (let t = 8_000; t <= 23_000; t += 1000) await limbo.promptRound(T0 + t);
    expect(sent.map((t) => t - T0)).toEqual([7_000, 22_000]);
  });

  it("ignores chat that is history, and chat from anybody who is not held", async () => {
    const { limbo, sent } = await room();
    limbo.held.set("pabulum", { uuid: "uuid-p", code: "ABC234", since: T0, lastReminder: T0, kind: "play" });
    await limbo.onEvent({ type: "chat", name: "pabulum", text: "old line" }, { replay: true });
    await limbo.onEvent({ type: "chat", name: "bramble09", text: "hello" });
    expect(sent).toEqual([]);
  });

  it("sends nothing while the server is not running, and nothing to somebody who has left", async () => {
    const { limbo, sent, tail } = await room();
    limbo.held.set("pabulum", { uuid: "uuid-p", code: "ABC234", since: T0, lastReminder: T0, kind: "closed" });
    tail.state = 30;
    await limbo.promptRound(T0 + 20_000);
    tail.state = 20;
    await limbo.onEvent({ type: "leave", name: "pabulum", reason: null });
    await limbo.promptRound(T0 + 40_000);
    expect(sent).toEqual([]);
  });
});

describe("what a held player sees", () => {
  it("at 0 s (the hold) and every 15 s after (the reminder): a title that stays, the subtitle, the action bar and one chat line", () => {
    const hold = actions["limbo.hold"].build(ctx, { name: "Pabulum", code: "ABC234" });
    const remind = actions["limbo.remind"].build(ctx, { name: "Pabulum", code: "ABC234" });
    const screen = [
      "title @a[name=Pabulum,tag=!verified] times 0 400 0",
      'title @a[name=Pabulum,tag=!verified] subtitle {"text":"Click the link in chat, or go to deepslate.dsw.test/join and enter ABC-234","color":"white"}',
      'title @a[name=Pabulum,tag=!verified] title {"text":"Sign in to play","color":"gold"}',
      'title @a[name=Pabulum,tag=!verified] actionbar {"text":"Click the link in chat, or go to deepslate.dsw.test/join and enter ABC-234","color":"yellow"}',
    ];
    expect(remind).toEqual([...screen, linkTellraw("Pabulum", URL_, "ABC234")]);
    expect(hold.slice(-5)).toEqual(remind);
    expect(hold[0]).toBe("tag Pabulum remove verified");
    expect(hold.filter((c) => c.startsWith("tellraw")).length).toBe(1); // one line, not a wall
  });

  it("one chat line, all of it a link to /link/<code>, with the code for /join in it", () => {
    const parts = JSON.parse(linkTellraw("Pabulum", URL_, "ABC234").slice("tellraw Pabulum ".length)) as Array<{ text: string; clickEvent?: { action: string; value: string } }>;
    expect(parts.map((p) => p.text).join("")).toBe("Click here to sign in, or go to deepslate.dsw.test/join and enter ABC-234");
    expect(parts[0]!.clickEvent).toEqual({ action: "open_url", value: "https://deepslate.dsw.test/link/ABC234" }); // the parent: every part inherits it
    expect(parts.slice(1).every((p) => !p.clickEvent)).toBe(true);
  });

  it("their own words while they wait for Play first, or for the server to open", () => {
    expect(screenText("play", URL_)).toEqual({ title: "Press Play first", subtitle: "Press Play on deepslate.dsw.test and you'll be let in" });
    expect(screenText("closed", URL_)).toEqual({ title: "Not open yet", subtitle: "You'll be let in when the server goes live" });
    expect(actions["limbo.remindPlay"].build(ctx, { name: "Pabulum" }).slice(0, 4)).toEqual(screenCommands("Pabulum", "play", URL_));
    expect(actions["limbo.holdClosed"].build(ctx, { name: "Pabulum" })).toEqual(expect.arrayContaining(screenCommands("Pabulum", "closed", URL_)));
    expect(actions["limbo.remindClosed"].build(ctx, { name: "Pabulum" }).length).toBe(5);
  });

  it("the action bar between two prompts", () => {
    expect(actions["limbo.bar"].build(ctx, { name: "Pabulum", kind: "link", code: "ABC234" })).toEqual(['title @a[name=Pabulum,tag=!verified] actionbar {"text":"Click the link in chat, or go to deepslate.dsw.test/join and enter ABC-234","color":"yellow"}']);
    expect(actions["limbo.bar"].input.safeParse({ name: "Pabulum", kind: "link", code: "ABC23" }).success).toBe(false);
  });

  it("all three gone the moment they are let in, before they are marked", () => {
    for (const cmds of [actions["link.release"].build(ctx, { name: "Pabulum" }), actions["limbo.releaseBack"].build(ctx, { name: "Pabulum", back: null })]) {
      const clear = ["title @a[name=Pabulum,tag=!verified] clear", "title @a[name=Pabulum,tag=!verified] reset", 'title @a[name=Pabulum,tag=!verified] actionbar ""'];
      expect(cmds).toEqual(expect.arrayContaining(clear));
      expect(cmds.indexOf(clear[0]!)).toBeLessThan(cmds.indexOf("tag Pabulum add verified"));
      expect(cmds.at(-1)).toBe("tag Pabulum add verified");
    }
  });

  it("the room has a second sign, with where to sign in", () => {
    const cmds = actions["limbo.build"].build({ ...ctx, siteName: "Deepslate Works" }, {});
    expect(cmds).toContain(`execute in deepslate:limbo run setblock -1 65 -3 minecraft:oak_sign[rotation=0]{front_text:{messages:['{"text":""}','{"text":"Deepslate Works"}','{"text":""}','{"text":""}']},is_waxed:1b}`);
    expect(cmds).toContain(`execute in deepslate:limbo run setblock 1 65 -3 minecraft:oak_sign[rotation=0]{front_text:{messages:['{"text":"Sign in at"}','{"text":"deepslate."}','{"text":"dsw.test/join"}','{"text":"code in chat"}']},is_waxed:1b}`);
    expect(cmds).toContain("gamerule logAdminCommands false");
  });
});

describe("the join code", () => {
  const now = new Date("2026-09-29T20:00:00Z");

  it("is 6 characters that cannot be misread, shown as ABC-123", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const c = makeCode((n) => Math.floor(Math.random() * n));
      expect(c).toMatch(CODE_RE);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(490);
    expect(CODE_ALPHABET).not.toMatch(/[01OI]/);
    expect(showCode("ABC234")).toBe("ABC-234");
    expect(readCode(" abc-234 ")).toBe("ABC234");
    expect(readCode("abc 234")).toBe("ABC234");
  });

  it("lasts 30 minutes, to the millisecond, and only for whoever has not been beaten to it", () => {
    const made = (at: Date) => ({ expiresAt: new Date(at.getTime() + CODE_TTL_MS), usedById: null as string | null });
    expect(CODE_TTL_MS).toBe(30 * 60_000);
    expect(codeUsable(made(now), "u1", new Date(now.getTime() + 29 * 60_000 + 59_999))).toBe(true);
    expect(codeUsable(made(now), "u1", new Date(now.getTime() + 30 * 60_000))).toBe(false);
    expect(codeUsable({ ...made(now), usedById: "u2" }, "u1", now)).toBe(false);
    expect(codeUsable({ ...made(now), usedById: "u1" }, "u1", now)).toBe(true); // the same member clicking twice
    expect(codeUsable(null, "u1", now)).toBe(false);
  });

  describe("in the room", () => {
    beforeEach(() => { codes.rows.length = 0; });

    it("is made anew on every join: the one from before stops working", async () => {
      const { limbo } = await room();
      const codeFor = (limbo as unknown as { codeFor: (u: string, n: string, fresh?: boolean, now?: Date) => Promise<string> }).codeFor.bind(limbo);
      const first = await codeFor("uuid-p", "pabulum", true, now);
      expect(first).toMatch(CODE_RE);
      expect(codes.rows[0]!.expiresAt).toEqual(new Date(now.getTime() + CODE_TTL_MS));
      const later = new Date(now.getTime() + 60_000);
      expect(await codeFor("uuid-p", "pabulum", false, later)).toBe(first); // still in the room: the same code
      const rejoin = await codeFor("uuid-p", "pabulum", true, later); // left and joined again
      expect(rejoin).not.toBe(first);
      expect(codeUsable(codes.rows.find((r) => r.code === first)!, "u1", later)).toBe(false);
      expect(codeUsable(codes.rows.find((r) => r.code === rejoin)!, "u1", later)).toBe(true);
    });

    it("is replaced when it runs out while they wait", async () => {
      const { limbo } = await room();
      const codeFor = (limbo as unknown as { codeFor: (u: string, n: string, fresh?: boolean, now?: Date) => Promise<string> }).codeFor.bind(limbo);
      const first = await codeFor("uuid-p", "pabulum", true, now);
      const after = new Date(now.getTime() + CODE_TTL_MS + 1);
      const next = await codeFor("uuid-p", "pabulum", false, after);
      expect(next).not.toBe(first);
      expect(codes.rows.find((r) => r.code === next)!.expiresAt).toEqual(new Date(after.getTime() + CODE_TTL_MS));
    });
  });
});
