import { describe, expect, it, vi } from "vitest";
import { actions, BOOK_TAG, bookItem, bookPages, parsePlace } from "../src/actions/registry.js";

// The sign-in book (planner, 2026-09-30): a Microsoft account with chat switched off never opens the chat, so the
// chat link cannot be clicked. The book's link opens from the book's own screen.

const sent = vi.hoisted(() => ({ list: [] as Array<{ name: string; input: unknown }> }));
vi.mock("../src/actions/run.js", () => ({
  runAction: async (_amp: unknown, _ctx: unknown, name: string, input: unknown) => {
    sent.list.push({ name, input });
    return { ok: true };
  },
}));
const codes = vi.hoisted(() => ({ next: "ABC234", expired: false }));
vi.mock("../src/db.js", () => ({
  db: {
    linkCode: {
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => (codes.expired ? null : { code: codes.next }),
      findUnique: async () => null,
      create: async ({ data }: { data: { code: string } }) => data,
    },
  },
}));

const URL_ = "https://deepslate.dsw.test";
const ctx = { limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: null, portalUrl: URL_ };
const TAGGED = `minecraft:written_book[minecraft:custom_data={${BOOK_TAG}:1b}]`;

describe("the book", () => {
  it("page 1: the welcome and the link, as a link looks; page 2: the code for a phone", () => {
    const [one, two] = bookPages(URL_, "ABC234") as Array<Array<string | { text: string; color?: string; underlined?: boolean; clickEvent?: { action: string; value: string } }>>;
    const text = (p: typeof one) => p!.map((c) => (typeof c === "string" ? c : c.text)).join("");
    expect(text(one)).toBe("Welcome!\n\nClick the link below to sign in with Discord. It opens in your browser.\n\nSign in with Discord");
    const link = one!.find((c) => typeof c !== "string" && c.clickEvent) as { color: string; underlined: boolean; clickEvent: unknown };
    expect(link.clickEvent).toEqual({ action: "open_url", value: "https://deepslate.dsw.test/link/ABC234" }); // the chat line's link
    expect(link).toMatchObject({ color: "blue", underlined: true });
    expect(text(two)).toBe("No browser on this PC?\n\nOn your phone, go to deepslate.dsw.test/join and enter ABC-234.");
  });

  it("is a written book titled Sign in to play, by Deepslate Works, with our tag, and the pages readable as SNBT strings", () => {
    const item = bookItem(URL_, "ABC234");
    expect(item.startsWith('minecraft:written_book[minecraft:written_book_content={title:"Sign in to play",author:"Deepslate Works",pages:[\'')).toBe(true);
    expect(item.endsWith(`],resolved:1b},minecraft:custom_data={${BOOK_TAG}:1b}]`)).toBe(true);
    // every page is one single-quoted string whose content, un-escaped, is the JSON of the page
    const pages = [...item.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => JSON.parse(m[1]!.replace(/\\(.)/g, "$1")) as unknown);
    expect(pages).toEqual(bookPages(URL_, "ABC234"));
  });

  it("is given in place of an earlier one of ours: cleared by the tag first, then into an empty hand or else the inventory", () => {
    const cmds = actions["limbo.giveBook"].build(ctx, { name: "Pabulum", code: "ABC234" });
    expect(cmds[0]).toBe(`clear @a[name=Pabulum,tag=!verified] ${TAGGED}`);
    expect(cmds[1]).toBe(`execute as @a[name=Pabulum,tag=!verified] if items entity @s weapon.mainhand * run give @s ${bookItem(URL_, "ABC234")}`);
    expect(cmds[2]).toBe(`execute as @a[name=Pabulum,tag=!verified] unless items entity @s weapon.mainhand * run item replace entity @s weapon.mainhand with ${bookItem(URL_, "ABC234")}`);
    expect(cmds.length).toBe(3);
  });

  it("comes with the hold, after they are put in the room and before the prompt", () => {
    const hold = actions["limbo.hold"].build(ctx, { name: "Pabulum", code: "ABC234" });
    const give = actions["limbo.giveBook"].build(ctx, { name: "Pabulum", code: "ABC234" });
    const at = hold.indexOf(give[0]!);
    expect(hold.slice(at, at + 3)).toEqual(give);
    expect(at).toBeGreaterThan(hold.findIndex((c) => c.includes("run tp Pabulum")));
    expect(at).toBeLessThan(hold.findIndex((c) => c.startsWith("title")));
  });

  it("is given again when it is gone from the inventory and the off hand; looked for by the tag, nothing cleared", () => {
    const cmds = actions["limbo.bookCheck"].build(ctx, { name: "Pabulum", code: "ABC234" });
    expect(cmds[0]).toBe(`execute as @a[name=Pabulum,tag=!verified] unless items entity @s container.* ${TAGGED} unless items entity @s weapon.offhand ${TAGGED} run tag @s add deepslate_nobook`);
    expect(cmds.slice(1, 3).every((c) => c.startsWith("execute as @a[name=Pabulum,tag=!verified,tag=deepslate_nobook] "))).toBe(true);
    expect(cmds.at(-1)).toBe("execute as @a[name=Pabulum,tag=deepslate_nobook] run tag @s remove deepslate_nobook");
    expect(cmds.some((c) => c.startsWith("clear"))).toBe(false);
  });

  it("is taken back on release, by the tag, before they are marked; and when they are put in the room for another wait", () => {
    for (const cmds of [actions["link.release"].build(ctx, { name: "Pabulum" }), actions["limbo.releaseBack"].build(ctx, { name: "Pabulum", back: null })]) {
      const take = `clear @a[name=Pabulum,tag=!verified] ${TAGGED}`;
      expect(cmds).toContain(take);
      expect(cmds.indexOf(take)).toBeLessThan(cmds.indexOf("tag Pabulum add verified"));
      expect(cmds.filter((c) => c.startsWith("clear"))).toEqual([take]); // nothing else in the inventory
    }
    expect(actions["limbo.holdPlay"].build(ctx, { name: "Pabulum" })).toContain(`clear Pabulum ${TAGGED}`);
  });

  it("takes only a name and a code of the right shape", () => {
    for (const a of ["limbo.giveBook", "limbo.bookCheck"] as const) {
      expect(actions[a].input.safeParse({ name: "Pabulum", code: "ABC234" }).success).toBe(true);
      expect(actions[a].input.safeParse({ name: "Pabulum", code: "ABC23'" }).success).toBe(false);
      expect(actions[a].input.safeParse({ name: "@a", code: "ABC234" }).success).toBe(false);
      expect(actions[a].role).toBe("system");
    }
  });
});

describe("the room hands out books", () => {
  const T0 = 1_790_000_000_000;
  async function room() {
    const { Limbo } = await import("../src/players/limbo.js");
    const tail = { online: new Set(["pabulum"]), uuidByName: new Map([["pabulum", "uuid-p"]]), state: 20, on() {}, onResync() {} };
    const env = { LIMBO_POS: "deepslate:limbo 0.5 65 0.5", SPAWN_POS: "", PORTAL_URL: URL_ } as never;
    return new Limbo(env, {} as never, tail as never, () => {});
  }

  it("a new book when the code has changed at a reminder, none when it is the same", async () => {
    const limbo = await room();
    limbo.held.set("pabulum", { uuid: "uuid-p", code: "ABC234", since: T0, lastReminder: T0, kind: "link" });
    sent.list = [];
    codes.next = "ABC234";
    await limbo.promptRound(T0 + 15_000);
    expect(sent.list.map((s) => s.name)).toEqual(["limbo.remind"]);
    sent.list = [];
    codes.next = "XYZ789"; // the 30 minutes ran out
    await limbo.promptRound(T0 + 30_000);
    expect(sent.list).toEqual([{ name: "limbo.giveBook", input: { name: "pabulum", code: "XYZ789" } }, { name: "limbo.remind", input: { name: "pabulum", code: "XYZ789" } }]);
  });

  it("looks for the book every round of the room (5 s), only for someone waiting to sign in", async () => {
    const limbo = await room();
    limbo.held.set("pabulum", { uuid: "uuid-p", code: "ABC234", since: T0, lastReminder: T0, kind: "link" });
    sent.list = [];
    vi.spyOn(Date, "now").mockReturnValue(T0 + 5_000);
    await (limbo as unknown as { tick: () => Promise<void> }).tick();
    vi.restoreAllMocks();
    expect(sent.list.map((s) => s.name)).toContain("limbo.bookCheck");
    expect(sent.list.find((s) => s.name === "limbo.bookCheck")!.input).toEqual({ name: "pabulum", code: "ABC234" });
  });
});
