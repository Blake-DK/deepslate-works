import { z } from "zod";
import { NOT_OPEN_TEXT } from "../shared/access.js";
import { MISSING_MODS_TEXT } from "../shared/join-gate.js";
import { VOTE_FIRST_TEXT } from "../shared/polls.js";
import { CODE_RE, showCode } from "../shared/join-code.js";
import { COMPONENTS_RE, ITEM_RE, SLOT_RE } from "../shared/slots.js";

// docs/08 + docs/14: every console command the api ever sends is built here from validated input.
// "system" actions are run by the api itself (join hook, timers); the rest need an ADMIN caller.

export const MC_NAME = z.string().regex(/^[A-Za-z0-9_]{3,16}$/);
/** The id of a season, a boss or a trial, as the season files have them. */
export const SEASON_ID = z.string().regex(/^[a-z0-9_]{1,32}$/);
const POS = /^(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)$/;
const DIMENSION = /^[a-z0-9_.-]{1,64}:[a-z0-9_./-]{1,64}$/;

export type Pos = { x: number; y: number; z: number };

/** The spawn claim (docs/24 §7): 8 by 8 chunks, 128 by 128 blocks, the spawn's chunk the fifth from the west and the
 *  north, on chunk edges. No SPAWN_POS: around 0, 0 (blocks -64 to 63), as before. Block coordinates, both ends in. */
export function spawnClaimArea(spawn: Pos | null): { x1: number; z1: number; x2: number; z2: number } {
  const cx = Math.floor((spawn?.x ?? 0) / 16), cz = Math.floor((spawn?.z ?? 0) / 16);
  return { x1: (cx - 4) * 16, z1: (cz - 4) * 16, x2: (cx + 4) * 16 - 1, z2: (cz + 4) * 16 - 1 };
}
export function parsePos(s: string): Pos {
  const m = POS.exec(s);
  if (!m) throw new Error(`bad position "${s}"`);
  return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
}

/** Where somebody stands: "deepslate:limbo 0.5 65 0.5". Without a dimension it is the overworld. */
export type Place = Pos & { dimension: string };
export function parsePlace(s: string): Place {
  const parts = s.trim().split(" ");
  const dimension = parts.length === 4 ? parts.shift()! : "minecraft:overworld";
  if (!DIMENSION.test(dimension)) throw new Error(`bad dimension in "${s}"`);
  return { dimension, ...parsePos(parts.join(" ")) };
}

export type ActionCtx = { limbo: Place; spawn: Pos | null; portalUrl: string; siteName?: string; /** Admin → Branding tagline */ tagline?: string };

export type Action<I> = {
  name: string;
  role: "system" | "ADMIN";
  input: z.ZodType<I>;
  build: (ctx: ActionCtx, input: I) => string[];
  /** What the event log keeps of the input, when not all of it (docs/22: chat from Discord keeps who and how long). */
  audit?: (input: I) => object;
  /** Milliseconds to wait between the commands, when the server refuses a command sent straight after the one before. */
  gapMs?: number;
};

const define = <I,>(a: Action<I>) => a;

// Clearing items on the ground (status/ground.ts) and the datapack deepslate-tools it needs.
export const COUNTED = ["items", "xp", "hostile", "passive", "contraptions", "corpses", "all"] as const;
export type Counted = (typeof COUNTED)[number];
export const COUNT_SELECTORS: Record<Counted, string> = {
  items: "@e[type=minecraft:item]",
  xp: "@e[type=minecraft:experience_orb]",
  hostile: "@e[type=#deepslate:hostile]",
  passive: "@e[type=#deepslate:passive]",
  contraptions: "@e[type=#deepslate:contraptions]",
  corpses: "@e[type=corpse:corpse]",
  all: "@e",
};
/** 2400 ticks = 2 minutes; the score is the item's Age, written by the datapack's ground/mark function. */
export const OLD_ITEM_TICKS = 2400;
export const OLD_ITEMS = `@e[type=minecraft:item,scores={deepslate_age=${OLD_ITEM_TICKS}..}]`;
export const GROUND_MARK = "deepslate:ground/mark";
export const GROUND_DONE = "deepslate:ground/done";

// The room: a box 11 wide, 7 high, 11 long around LIMBO_POS, which is where people stand: the floor is the
// block under their feet. Since 2026-09-29 it is in a dimension of its own (docs/14) and made of glass.
const block = (c: Pos) => ({ x: Math.floor(c.x), y: Math.floor(c.y), z: Math.floor(c.z) });
export const roomBounds = (c: Pos) => {
  const b = block(c);
  return { x1: b.x - 5, y1: b.y - 1, z1: b.z - 5, x2: b.x + 5, y2: b.y + 5, z2: b.z + 5 };
};
const inside = (c: Pos) => {
  const b = block(c);
  return `x=${b.x - 4},y=${b.y},z=${b.z - 4},dx=8,dy=4,dz=8`;
};
const at = (c: Pos) => `${c.x} ${c.y} ${c.z}`;
const inDim = (dimension: string, cmd: string) => `execute in ${dimension} run ${cmd}`;
const ow = (cmd: string) => inDim("minecraft:overworld", cmd);
/** Into the room, from whichever dimension they are in. */
const toRoom = (ctx: ActionCtx, who: string) => inDim(ctx.limbo.dimension, `tp ${who} ${at(ctx.limbo)}`);
/** Into the room, whatever they wait for: adventure mode, and they cannot walk or jump. */
const intoRoom = (ctx: ActionCtx, name: string) => [
  `tag ${name} remove verified`,
  `gamemode adventure ${name}`,
  toRoom(ctx, name),
  `effect give ${name} minecraft:slowness infinite 255 true`,
  `effect give ${name} minecraft:jump_boost infinite 250 true`,
  takeBook(name), // a sign-in book from an earlier wait; limbo.hold gives a new one
];

/** Only what is safe to show in chat: the name comes from a settings page, not from code. */
export const chatSafe = (s: string | undefined, fallback: string) => (s ?? "").replace(/[^\p{L}\p{N} .,'!&()+-]/gu, "").trim().slice(0, 40) || fallback;

const hostOf = (portalUrl: string) => portalUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");

/**
 * The link line: one chat message, all of it clickable (the first part is the parent, the rest inherit its click).
 * Sent again every 15 s while they wait, and at once when they say something (players/limbo.ts), so it is kept to
 * one message: the chat fades after 10 s and would otherwise fill with it.
 */
/** Pure: a sign's lines (four of 15 characters at most), the words kept whole where they fit. */
export function signLines(text: string, max = 4): string[] {
  const out: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = out.at(-1);
    if (last !== undefined && (last + " " + word).length <= 15) out[out.length - 1] = `${last} ${word}`;
    else out.push(word.slice(0, 15));
  }
  return out.slice(0, max);
}

/** The first line everyone gets on joining: the server's name and its tagline (Admin → Branding). */
export function welcomeTellraw(name: string, siteName?: string, tagline?: string): string {
  const t = chatSafe(tagline, "");
  return `tellraw ${name} ${JSON.stringify(["", { text: chatSafe(siteName, "Deepslate Works"), color: "gold", bold: true }, ...(t ? [{ text: ` · ${t}`, color: "gray", bold: false }] : [])])}`;
}

export function linkTellraw(name: string, portalUrl: string, code: string, siteName?: string): string {
  const url = `${portalUrl}/link/${code}`;
  const host = hostOf(portalUrl);
  const payload = [
    { text: "", clickEvent: { action: "open_url", value: url }, hoverEvent: { action: "show_text", value: `Sign in to ${chatSafe(siteName, "Deepslate Works")}: opens ${host}/link/${code}` } },
    { text: "Click here to sign in", color: "gold", underlined: true },
    { text: `, or right-click the book in your hand, or go to ${host}/join and enter ${showCode(code)}`, color: "gray" },
  ];
  return `tellraw ${name} ${JSON.stringify(payload)}`;
}

// ---- the sign-in book (planner, 2026-09-30) ------------------------------------------------------------------
// A Microsoft account with chat switched off (Xbox privacy or family settings) never opens the chat screen, so the
// chat link cannot be clicked. A link in a book opens from the book's own screen, which that setting does not block.
// The book is ours by its custom_data tag: it is replaced, given again and taken back by that tag and nothing else.
export const BOOK_TAG = "deepslate_signin";
const BOOK_MATCH = `minecraft:written_book[minecraft:custom_data={${BOOK_TAG}:1b}]`;
/** A text component as it goes into SNBT between single quotes. */
const snbtString = (json: string) => `'${json.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** The two pages, as text components: the link, then the code for a phone. */
export function bookPages(portalUrl: string, code: string): unknown[] {
  const host = hostOf(portalUrl);
  const url = `${portalUrl.replace(/\/+$/, "")}/link/${code}`;
  return [
    ["", { text: "Welcome!\n\nClick the link below to sign in with Discord. It opens in your browser.\n\n" },
      { text: "Sign in with Discord", color: "blue", underlined: true, clickEvent: { action: "open_url", value: url }, hoverEvent: { action: "show_text", value: `Opens ${host}/link/${code}` } }],
    ["", { text: `No browser on this PC?\n\nOn your phone, go to ${host}/join and enter ` }, { text: showCode(code), bold: true }, { text: "." }],
  ];
}

/** The book as an item stack argument (1.21.1 components: pages are JSON text components in SNBT strings). */
export function bookItem(portalUrl: string, code: string): string {
  const pages = bookPages(portalUrl, code).map((p) => snbtString(JSON.stringify(p))).join(",");
  return `minecraft:written_book[minecraft:written_book_content={title:"Sign in to play",author:"Deepslate Works",pages:[${pages}],resolved:1b},minecraft:custom_data={${BOOK_TAG}:1b}]`;
}

/**
 * Into their hand if it is empty, otherwise into the inventory. `who` is a held player's selector. The order matters:
 * a book put into an empty hand first would make the hand full for the second line.
 */
const placeBook = (who: string, item: string) => [
  `execute as ${who} if items entity @s weapon.mainhand * run give @s ${item}`,
  `execute as ${who} unless items entity @s weapon.mainhand * run item replace entity @s weapon.mainhand with ${item}`,
];

/** Our book out of their inventory, and nothing else: matched by its tag. */
export const takeBook = (who: string) => `clear ${who} ${BOOK_MATCH}`;

/** The book, replacing any earlier one of ours (a new code, a rejoin): never two. */
export function giveBookCommands(name: string, portalUrl: string, code: string): string[] {
  const held = `@a[name=${name},tag=!verified]`;
  return [takeBook(held), ...placeBook(held, bookItem(portalUrl, code))];
}

/** Every 5 s: if the book is gone (dropped, or thrown into the void), a new one. Nothing is cleared, so nothing to log. */
export function bookCheckCommands(name: string, portalUrl: string, code: string): string[] {
  const held = `@a[name=${name},tag=!verified]`;
  const mark = "deepslate_nobook";
  return [
    `execute as ${held} unless items entity @s container.* ${BOOK_MATCH} unless items entity @s weapon.offhand ${BOOK_MATCH} run tag @s add ${mark}`,
    ...placeBook(`@a[name=${name},tag=!verified,tag=${mark}]`, bookItem(portalUrl, code)),
    `execute as @a[name=${name},tag=${mark}] run tag @s remove ${mark}`, // says nothing when there is nobody to untag
  ];
}

/** Who waits in the room, and for what: to link their Discord, for Play first, for the server to open, or for a new installer. */
export type HeldKind = "link" | "play" | "closed" | "old" | "mods" | "vote";

/** What stays on their screen while they wait (docs/14 "The prompt"). */
export function screenText(kind: HeldKind, portalUrl: string, code = ""): { title: string; subtitle: string; bar?: string } {
  const host = hostOf(portalUrl);
  // 2026-09-30 (planner): an account with chat switched off never opens the chat, so the book comes first on screen
  if (kind === "link") return { title: "Sign in to play", subtitle: `Right-click the book, or go to ${host}/join and enter ${showCode(code)}`, bar: `Click the link in chat or right-click the book in your hand, or go to ${host}/join and enter ${showCode(code)}` };
  if (kind === "play") return { title: "Press Play first", subtitle: `Press Play on ${host} and you'll be let in` };
  // 2026-10-02: every copy from 1.4.0 up updates itself on Play (to the app since 2.2.0/3.1.0), so Play comes first
  if (kind === "old") return { title: "Update Deepslate Works", subtitle: `Press Play on ${host}: it updates itself` };
  if (kind === "mods") return { title: "Your game is missing some mods", subtitle: `Press Play on ${host} to fix it` };
  // planner 2026-10-02: a must-vote poll they have not answered
  if (kind === "vote") return { title: "There's a new vote", subtitle: `Open Deepslate Works or ${host} to vote, then you're in` };
  return { title: "Not open yet", subtitle: "You'll be let in when the server goes live" };
}

const component = (text: string, color: string) => JSON.stringify({ text, color });

/** Title and subtitle that stay 20 s (400 ticks, no fading) and are sent again every 15 s, so they never go; the same words on the action bar. */
/** Only while they are held: a prompt still on its way when they are let in (they have the tag by then) shows nothing. */
export function screenCommands(name: string, kind: HeldKind, portalUrl: string, code = ""): string[] {
  const t = screenText(kind, portalUrl, code);
  const who = `@a[name=${name},tag=!verified]`;
  return [
    `title ${who} times 0 400 0`,
    `title ${who} subtitle ${component(t.subtitle, "white")}`,
    `title ${who} title ${component(t.title, "gold")}`,
    `title ${who} actionbar ${component(t.bar ?? t.subtitle, "yellow")}`,
  ];
}

/** Title, subtitle and action bar gone, and the title times back to the game's own. */
export const clearScreen = (who: string) => [`title ${who} clear`, `title ${who} reset`, `title ${who} actionbar ""`];

const COORD = z.number().finite().min(-30_000_000).max(30_000_000);

export function closedTellraw(name: string): string {
  return `tellraw ${name} ${JSON.stringify(["", { text: NOT_OPEN_TEXT, color: "gold" }])}`;
}

/** Settings → Joining "Minimum installer version": their last run was from an older installer (planner, installer 1.5.0). */
export function oldTellraw(name: string, portalUrl: string): string {
  const host = hostOf(portalUrl);
  const url = `${portalUrl.replace(/\/+$/, "")}/install`;
  const payload = [
    "",
    { text: "Press Play on ", color: "gold" },
    { text: host, color: "aqua", underlined: true, clickEvent: { action: "open_url", value: portalUrl.replace(/\/+$/, "") }, hoverEvent: { action: "show_text", value: "Opens the site in your browser" } },
    { text: ": Deepslate Works updates itself, then you can join. If Play does nothing, download it again from ", color: "gold" },
    { text: `${host}/install`, color: "aqua", underlined: true, clickEvent: { action: "open_url", value: url }, hoverEvent: { action: "show_text", value: "Opens the install page in your browser" } },
    { text: ".", color: "gold" },
  ];
  return `tellraw ${name} ${JSON.stringify(payload)}`;
}

/** 2.1.0: their game was seen without some of the pack's mods (MISSING_MODS_TEXT, with the site as a link). */
export function modsTellraw(name: string, portalUrl: string): string {
  const host = hostOf(portalUrl);
  const payload = [
    "",
    { text: "Your game is missing some mods. Press Play on ", color: "gold" },
    { text: host, color: "aqua", underlined: true, clickEvent: { action: "open_url", value: portalUrl }, hoverEvent: { action: "show_text", value: "Opens the portal in your browser" } },
    { text: " to fix it.", color: "gold" },
  ];
  return `tellraw ${name} ${JSON.stringify(payload)}`;
}

/** Planner 2026-10-02: a must-vote poll they have not answered (VOTE_FIRST_TEXT, with the site as a link). */
export function voteTellraw(name: string, portalUrl: string): string {
  const host = hostOf(portalUrl);
  const [before, after] = VOTE_FIRST_TEXT(host).split(host) as [string, string];
  const payload = [
    "",
    { text: before, color: "gold" },
    { text: host, color: "aqua", underlined: true, clickEvent: { action: "open_url", value: `${portalUrl.replace(/\/+$/, "")}/votes` }, hoverEvent: { action: "show_text", value: "Opens the vote in your browser" } },
    { text: after, color: "gold" },
  ];
  return `tellraw ${name} ${JSON.stringify(payload)}`;
}

/** Planner 2026-10-02: a poll opened while people are playing. They are not held for it now; a chat line to all. */
export function pollChat(question: string, portalUrl: string): string {
  const host = hostOf(portalUrl);
  const payload = [
    "",
    { text: "New vote: ", color: "gold", bold: true },
    { text: `${question} `, color: "white" },
    { text: "Vote in Deepslate Works or on ", color: "gold" },
    { text: host, color: "aqua", underlined: true, clickEvent: { action: "open_url", value: `${portalUrl.replace(/\/+$/, "")}/votes` }, hoverEvent: { action: "show_text", value: "Opens the vote in your browser" } },
    { text: "; it's asked before your next game.", color: "gold" },
  ];
  return `tellraw @a[tag=verified] ${JSON.stringify(payload)}`;
}

export function playTellraw(name: string, portalUrl: string): string {
  const host = hostOf(portalUrl);
  const payload = [
    "",
    { text: "Press Play on ", color: "gold" },
    { text: host, color: "aqua", underlined: true, clickEvent: { action: "open_url", value: portalUrl }, hoverEvent: { action: "show_text", value: "Opens the portal in your browser" } },
    { text: " to join. That checks your mods are up to date.", color: "gold" },
  ];
  return `tellraw ${name} ${JSON.stringify(payload)}`;
}

const sameBox = (a: ReturnType<typeof roomBounds>, b: ReturnType<typeof roomBounds>) => a.x1 === b.x1 && a.y1 === b.y1 && a.z1 === b.z1 && a.x2 === b.x2 && a.y2 === b.y2 && a.z2 === b.z2;

export const actions = {
  "limbo.hold": define({
    name: "limbo.hold",
    role: "system",
    input: z.object({ name: MC_NAME, code: z.string().regex(CODE_RE) }),
    build: (ctx, { name, code }) => [...intoRoom(ctx, name), ...giveBookCommands(name, ctx.portalUrl, code), ...screenCommands(name, "link", ctx.portalUrl, code), linkTellraw(name, ctx.portalUrl, code, ctx.siteName)],
  }),
  // The book again: a new code while they wait. Replaces the old one.
  "limbo.giveBook": define({
    name: "limbo.giveBook",
    role: "system",
    input: z.object({ name: MC_NAME, code: z.string().regex(CODE_RE) }),
    build: (ctx, { name, code }) => giveBookCommands(name, ctx.portalUrl, code),
  }),
  // Every round of the room (5 s): a book that is gone is given again.
  "limbo.bookCheck": define({
    name: "limbo.bookCheck",
    role: "system",
    input: z.object({ name: MC_NAME, code: z.string().regex(CODE_RE) }),
    build: (ctx, { name, code }) => bookCheckCommands(name, ctx.portalUrl, code),
  }),
  "limbo.remind": define({
    name: "limbo.remind",
    role: "system",
    input: z.object({ name: MC_NAME, code: z.string().regex(CODE_RE) }),
    build: (ctx, { name, code }) => [...screenCommands(name, "link", ctx.portalUrl, code), linkTellraw(name, ctx.portalUrl, code, ctx.siteName)],
  }),
  // Between two prompts: the action bar fades after about three seconds, so it is sent again with every round of the room (5 s).
  "limbo.bar": define({
    name: "limbo.bar",
    role: "system",
    input: z.object({ name: MC_NAME, kind: z.enum(["link", "play", "closed", "old", "mods", "vote"]), code: z.string().regex(CODE_RE).optional() }),
    build: (ctx, { name, kind, code }) => {
      const t = screenText(kind, ctx.portalUrl, code);
      return [`title @a[name=${name},tag=!verified] actionbar ${component(t.bar ?? t.subtitle, "yellow")}`];
    },
  }),
  "limbo.keep": define({
    name: "limbo.keep",
    role: "system",
    input: z.object({}),
    // Anyone who waits and is in another dimension, or in the room's dimension but outside the room, is put back.
    build: (ctx) => [
      `execute as @a[tag=!verified] at @s unless dimension ${ctx.limbo.dimension} in ${ctx.limbo.dimension} run tp @s ${at(ctx.limbo)}`,
      `execute as @a[tag=!verified] at @s if dimension ${ctx.limbo.dimension} unless entity @s[${inside(ctx.limbo)}] run tp @s ${at(ctx.limbo)}`,
    ],
  }),
  "link.release": define({
    name: "link.release",
    role: "ADMIN",
    input: z.object({ name: MC_NAME }),
    build: (ctx, { name }) => {
      // Only someone who is being let out of the room (the hold took their tag away) is moved, reset and greeted.
      // A member who comes back, or a release that is run twice, changes nothing: they stay where they are.
      const held = `@a[name=${name},tag=!verified]`;
      return [
        `effect clear ${held}`,
        `gamemode survival ${held}`,
        ctx.spawn ? ow(`tp ${held} ${ctx.spawn.x} ${ctx.spawn.y} ${ctx.spawn.z}`) : ow(`spreadplayers 0 0 1 12 false ${held}`),
        `tellraw ${held} ${JSON.stringify([{ text: "Linked. Welcome in, ", color: "green" }, { text: name, color: "aqua" }, { text: ". Have fun.", color: "green" }])}`,
        ...clearScreen(held),
        takeBook(held),
        `whitelist add ${name}`,
        `tag ${name} add verified`, // last: everything above looks for its absence
      ];
    },
  }),
  // docs/14 "Play first": a member who has not pressed Play waits in the room too, and goes back to where they stood.
  "player.where": define({
    name: "player.where",
    role: "system",
    input: z.object({ name: MC_NAME }),
    build: (_ctx, { name }) => [`data get entity ${name} Pos`, `data get entity ${name} Dimension`],
  }),
  "limbo.holdPlay": define({
    name: "limbo.holdPlay",
    role: "system",
    input: z.object({ name: MC_NAME }),
    build: (ctx, { name }) => [...intoRoom(ctx, name), ...screenCommands(name, "play", ctx.portalUrl), playTellraw(name, ctx.portalUrl)],
  }),
  "limbo.remindPlay": define({
    name: "limbo.remindPlay",
    role: "system",
    input: z.object({ name: MC_NAME }),
    build: (ctx, { name }) => [...screenCommands(name, "play", ctx.portalUrl), playTellraw(name, ctx.portalUrl)],
  }),
  "limbo.releaseBack": define({
    name: "limbo.releaseBack",
    role: "system",
    input: z.object({
      name: MC_NAME,
      // where they stood when they joined; without it they go to spawn like anyone let out of the room
      back: z.object({ dimension: z.string().regex(/^[a-z0-9_.-]{1,64}:[a-z0-9_./-]{1,64}$/), x: COORD, y: z.number().finite().min(-2048).max(4096), z: COORD }).nullable(),
    }),
    build: (ctx, { name, back }) => {
      const held = `@a[name=${name},tag=!verified]`;
      const n = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
      return [
        `effect clear ${held}`,
        `gamemode survival ${held}`,
        back
          ? `execute in ${back.dimension} run tp ${held} ${n(back.x)} ${n(back.y)} ${n(back.z)}`
          : ctx.spawn ? ow(`tp ${held} ${ctx.spawn.x} ${ctx.spawn.y} ${ctx.spawn.z}`) : ow(`spreadplayers 0 0 1 12 false ${held}`),
        `tellraw ${held} ${JSON.stringify([{ text: "Mods checked. Welcome back, ", color: "green" }, { text: name, color: "aqua" }, { text: ".", color: "green" }])}`,
        ...clearScreen(held),
        takeBook(held),
        `tag ${name} add verified`,
      ];
    },
  }),
  // docs/13 §9: while the site is not live, a member without early access waits, whatever Play first says.
  "limbo.holdClosed": define({
    name: "limbo.holdClosed",
    role: "system",
    input: z.object({ name: MC_NAME }),
    build: (ctx, { name }) => [...intoRoom(ctx, name), ...screenCommands(name, "closed", ctx.portalUrl), closedTellraw(name)],
  }),
  "limbo.remindClosed": define({ name: "limbo.remindClosed", role: "system", input: z.object({ name: MC_NAME }), build: (ctx, { name }) => [...screenCommands(name, "closed", ctx.portalUrl), closedTellraw(name)] }),
  "limbo.kickIdleClosed": define({ name: "limbo.kickIdleClosed", role: "system", input: z.object({ name: MC_NAME }), build: (_ctx, { name }) => [`kick ${name} ${NOT_OPEN_TEXT}`] }),
  // Settings → Joining "Minimum installer version": held until a run from a new enough installer arrives.
  "limbo.holdOld": define({
    name: "limbo.holdOld",
    role: "system",
    input: z.object({ name: MC_NAME }),
    build: (ctx, { name }) => [...intoRoom(ctx, name), ...screenCommands(name, "old", ctx.portalUrl), oldTellraw(name, ctx.portalUrl)],
  }),
  "limbo.remindOld": define({ name: "limbo.remindOld", role: "system", input: z.object({ name: MC_NAME }), build: (ctx, { name }) => [...screenCommands(name, "old", ctx.portalUrl), oldTellraw(name, ctx.portalUrl)] }),
  // 2.1.0: their game was seen without some of the pack's mods since their last Play; Play repairs it.
  "limbo.holdMods": define({
    name: "limbo.holdMods",
    role: "system",
    input: z.object({ name: MC_NAME }),
    build: (ctx, { name }) => [...intoRoom(ctx, name), ...screenCommands(name, "mods", ctx.portalUrl), modsTellraw(name, ctx.portalUrl)],
  }),
  "limbo.remindMods": define({ name: "limbo.remindMods", role: "system", input: z.object({ name: MC_NAME }), build: (ctx, { name }) => [...screenCommands(name, "mods", ctx.portalUrl), modsTellraw(name, ctx.portalUrl)] }),
  // planner 2026-10-02: held until they answer the open must-vote polls; released within seconds of voting.
  "limbo.holdVote": define({
    name: "limbo.holdVote",
    role: "system",
    input: z.object({ name: MC_NAME }),
    build: (ctx, { name }) => [...intoRoom(ctx, name), ...screenCommands(name, "vote", ctx.portalUrl), voteTellraw(name, ctx.portalUrl)],
  }),
  "limbo.remindVote": define({ name: "limbo.remindVote", role: "system", input: z.object({ name: MC_NAME }), build: (ctx, { name }) => [...screenCommands(name, "vote", ctx.portalUrl), voteTellraw(name, ctx.portalUrl)] }),
  "limbo.kickIdleVote": define({ name: "limbo.kickIdleVote", role: "system", input: z.object({ name: MC_NAME }), build: (ctx, { name }) => [`kick ${name} ${VOTE_FIRST_TEXT(hostOf(ctx.portalUrl))}`] }),
  "server.pollOpened": define({
    name: "server.pollOpened",
    role: "system",
    input: z.object({ question: z.string().min(1).max(200).regex(/^[^\n\r]+$/) }),
    build: (ctx, { question }) => [pollChat(question.replace(/[§]/g, ""), ctx.portalUrl)],
  }),
  "limbo.kickIdleMods": define({ name: "limbo.kickIdleMods", role: "system", input: z.object({ name: MC_NAME }), build: (_ctx, { name }) => [`kick ${name} ${MISSING_MODS_TEXT}`] }),
  "limbo.kickIdleOld": define({
    name: "limbo.kickIdleOld",
    role: "system",
    input: z.object({ name: MC_NAME }),
    build: (ctx, { name }) => [`kick ${name} Press Play on ${ctx.portalUrl.replace(/^https?:\/\//, "")} to update Deepslate Works, then join again.`],
  }),
  "limbo.kickIdlePlay": define({
    name: "limbo.kickIdlePlay",
    role: "system",
    input: z.object({ name: MC_NAME }),
    build: (ctx, { name }) => [`kick ${name} Press Play on ${ctx.portalUrl.replace(/^https?:\/\//, "")} and join again.`],
  }),
  "limbo.kickIdle": define({
    name: "limbo.kickIdle",
    role: "system",
    input: z.object({ name: MC_NAME }),
    build: (ctx, { name }) => [`kick ${name} Link your Discord at ${ctx.portalUrl.replace(/^https?:\/\//, "")} and come back.`],
  }),
  "limbo.build": define({
    name: "limbo.build",
    role: "ADMIN",
    input: z.object({}),
    // Glass all round, so that the void and the stars are seen; a floor of sea lanterns; two signs in front of
    // whoever stands there: right-click the book (since 2026-09-30; the server's name before), and where to sign in
    // from a phone (docs/14 "The prompt"). `hollow`
    // empties the inside, so a sign of an earlier build does not stay behind.
    // logAdminCommands off: the room's prompt uses `title` every few seconds, and every `title` sent from the console
    // would otherwise be repeated to each operator in game ("[Server: Showing new title for …]").
    build: (ctx) => {
      const b = roomBounds(ctx.limbo);
      const c = block(ctx.limbo);
      const d = ctx.limbo.dimension;
      const line = (t: string) => `'${JSON.stringify({ text: t })}'`;
      const sign = (x: number, lines: string[]) => inDim(d, `setblock ${x} ${c.y} ${c.z - 3} minecraft:oak_sign[rotation=0]{front_text:{messages:[${lines.map(line).join(",")}]},is_waxed:1b}`);
      const host = hostOf(ctx.portalUrl).replace(/'/g, "");
      const dot = host.indexOf(".");
      const where = dot > 0 ? [host.slice(0, dot + 1), `${host.slice(dot + 1)}/join`] : [host, "/join"];
      return [
        inDim(d, `forceload add ${b.x1} ${b.z1} ${b.x2} ${b.z2}`),
        inDim(d, `fill ${b.x1} ${b.y1} ${b.z1} ${b.x2} ${b.y2} ${b.z2} minecraft:glass hollow`),
        inDim(d, `fill ${b.x1} ${b.y1} ${b.z1} ${b.x2} ${b.y1} ${b.z2} minecraft:sea_lantern`),
        // 2026-09-30 (planner): the book is the way in that always works, so the first sign points at it
        sign(c.x - 1, ["Right-click", "the book", "to sign in", ""]),
        sign(c.x + 1, ["Sign in at", where[0]!, where[1]!, "code on screen"]),
        // between them: the server's name and its tagline (Admin → Branding, planner 2026-10-01)
        // (no ' on a sign: the lines sit inside '…' in the command)
        sign(c.x, [chatSafe(ctx.siteName, "Deepslate Works").replace(/'/g, "").slice(0, 15), ...signLines(chatSafe(ctx.tagline, "").replace(/'/g, ""), 3)]),
        "gamerule logAdminCommands false",
      ];
    },
  }),
  // The room as it was until 2026-09-29, or any other that is no longer wanted: taken away, block by block.
  "limbo.clear": define({
    name: "limbo.clear",
    role: "ADMIN",
    input: z.object({ dimension: z.string().regex(DIMENSION), x: z.number().int().min(-100_000).max(100_000), y: z.number().int().min(-63).max(318), z: z.number().int().min(-100_000).max(100_000) }),
    build: (ctx, place) => {
      const same = place.dimension === ctx.limbo.dimension && sameBox(roomBounds(place), roomBounds(ctx.limbo));
      if (same) return []; // never the room that is in use
      const b = roomBounds(place);
      return [inDim(place.dimension, `fill ${b.x1} ${b.y1} ${b.z1} ${b.x2} ${b.y2} ${b.z2} minecraft:air`), inDim(place.dimension, `forceload remove ${b.x1} ${b.z1} ${b.x2} ${b.z2}`)];
    },
  }),
  "world.blockIs": define({
    name: "world.blockIs",
    role: "ADMIN",
    input: z.object({ dimension: z.string().regex(DIMENSION), x: z.number().int().min(-100_000).max(100_000), y: z.number().int().min(-63).max(318), z: z.number().int().min(-100_000).max(100_000), block: z.string().regex(/^[a-z0-9_.-]{1,40}:[a-z0-9_./-]{1,60}$/) }),
    build: (_ctx, p) => [`execute in ${p.dimension} if block ${p.x} ${p.y} ${p.z} ${p.block}`],
  }),
  "world.datapacks": define({ name: "world.datapacks", role: "ADMIN", input: z.object({}), build: () => ["datapack list"] }),
  "player.revoke": define({
    name: "player.revoke",
    role: "ADMIN",
    input: z.object({ name: MC_NAME, reason: z.string().max(120).regex(/^[\w .,'!?-]*$/).default("Your Discord isn't in the group's server any more.") }),
    build: (_ctx, { name, reason }) => [`tag ${name} remove verified`, `whitelist remove ${name}`, `kick ${name} ${reason}`],
  }),
  // Planner ruling 2026-09-30 (docs/13): admins get the Minecraft console as it is. One line, sent as typed, with a
  // leading "/" dropped; no list of allowed commands. Only through POST /console/send, which is rate-limited.
  "console.send": define({
    name: "console.send",
    role: "ADMIN",
    input: z.object({ command: z.string().max(1000).regex(/^[^\r\n]*$/).transform((c) => c.trim().replace(/^\/+/, "")).pipe(z.string().min(1)) }),
    build: (_ctx, { command }) => [command],
  }),
  // docs/22 §5: the one place where a person's free text goes to the console. One tellraw to verified players, its text
  // one JSON string from JSON.stringify of plain text components (no selector, click, hover, translation or NBT),
  // cleaned by discordChatText/discordChatName first and checked again here.
  "chat.fromDiscord": define({
    name: "chat.fromDiscord",
    role: "system",
    input: z.object({
      name: z.string().min(1).max(32).regex(/^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}§]+$/u),
      text: z.string().min(1).max(257).regex(/^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}§]+$/u),
      member: z.string().max(40).nullable(),
      // Settings → "Chat in the event log": false when it is off, and then the text is not kept
      log: z.boolean().optional(),
    }),
    build: (_ctx, { name, text }) => [`tellraw @a[tag=verified] ${JSON.stringify(["", { text: "[Discord] ", color: "blue" }, { text: name, color: "white" }, { text: `: ${text}`, color: "gray" }])}`],
    // Alex, 2026-10-04: Activity says what was said, as it does for chat typed in the game (docs/22 §5 kept only who
    // and how long). The same switch rules both: with chat logging off, the text is not kept here either.
    audit: ({ name, text, member, log }) => (log === false ? { name, member, length: text.length } : { name, member, length: text.length, text }),
  }),
  "server.say": define({
    name: "server.say",
    role: "ADMIN",
    input: z.object({ text: z.string().min(1).max(200).regex(/^[^\n\r]+$/) }),
    build: (_ctx, { text }) => [`say ${text.replace(/[§]/g, "")}`],
  }),
  "server.restartWarning": define({
    name: "server.restartWarning",
    role: "system",
    input: z.object({ minutes: z.number().int().min(0).max(120) }),
    build: (_ctx, { minutes }) => [minutes === 0 ? "say Restarting now. Back in a minute or two." : `say Server restarts in ${minutes} minute${minutes === 1 ? "" : "s"}. Get somewhere safe.`],
  }),
  "server.restartCancelled": define({ name: "server.restartCancelled", role: "system", input: z.object({}), build: () => ["say The restart has been called off."] }),
  "server.welcome": define({ name: "server.welcome", role: "system", input: z.object({ name: MC_NAME }), build: (ctx, { name }) => [welcomeTellraw(name, ctx.siteName, ctx.tagline)] }),
  "server.list": define({ name: "server.list", role: "system", input: z.object({}), build: () => ["list"] }),
  // spark: one player's ping (docs/05 "Connection"). spark has no command for everyone at once.
  "server.pings": define({ name: "server.pings", role: "system", input: z.object({ name: MC_NAME }), build: (_ctx, { name }) => [`spark ping --player ${name}`] }),
  // NeoForge's own tick report: TPS and milliseconds per tick, overall and per dimension (Admin → Server → Settings)
  // Clearing items on the ground and the entity counts (planner, 2026-10-01; status/ground.ts). Only item entities
  // older than 2 minutes are ever removed: the selector names minecraft:item and nothing else, so corpses, mobs,
  // pets, item frames, armour stands, minecarts and Create/TaCZ entities cannot match.
  "ground.count": define({ name: "ground.count", role: "system", input: z.object({ what: z.enum(COUNTED) }), build: (_ctx, { what }) => [`execute if entity ${COUNT_SELECTORS[what]}`] }),
  "ground.warn": define({
    name: "ground.warn",
    role: "system",
    input: z.object({ seconds: z.union([z.literal(60), z.literal(10)]) }),
    build: (_ctx, { seconds }) => [`tellraw @a ${JSON.stringify(["", { text: seconds === 60 ? "Clearing items on the ground in 60 s. Pick up anything you want to keep." : "Clearing items on the ground in 10 s.", color: "yellow" }])}`],
  }),
  "ground.mark": define({ name: "ground.mark", role: "system", input: z.object({}), build: () => [`function ${GROUND_MARK}`] }),
  "ground.kill": define({ name: "ground.kill", role: "system", input: z.object({}), build: () => [`kill ${OLD_ITEMS}`] }),
  "ground.done": define({
    name: "ground.done",
    role: "system",
    input: z.object({ removed: z.number().int().min(0).max(1_000_000) }),
    build: (_ctx, { removed }) => [`function ${GROUND_DONE}`, `tellraw @a ${JSON.stringify(["", { text: `Cleared ${removed} item${removed === 1 ? "" : "s"} from the ground.`, color: "gray" }])}`],
  }),
  "server.tps": define({ name: "server.tps", role: "system", input: z.object({}), build: () => ["neoforge tps"] }),
  // Open Parties and Claims (planner, 2026-10-01): the spawn area (blocks -64..63 around 0,0, 8×8 chunks) and the
  // entrance room's dimension are server claims, so no player can claim them. `anyway` lifts the size limit; claiming
  // what is already a server claim again changes nothing. Run once after OPAC's first start (Admin → Entrance room).
  "opac.serverClaims": define({
    name: "opac.serverClaims",
    role: "ADMIN",
    input: z.object({}),
    // 2026-10-03: the spawn claim follows SPAWN_POS (128 by 128 blocks around it, on chunk edges), and the two claims go
    // 10 s apart: Open Parties and Claims refuses a claim while the one before it is still working ("You have an
    // over-area claim action task currently in progress!").
    gapMs: 10_000,
    build: (ctx) => {
      const a = spawnClaimArea(ctx.spawn);
      return [`oclaims server claim in minecraft:overworld ${a.x1} ${a.z1} ${a.x2} ${a.z2} anyway`, "oclaims server claim in deepslate:limbo -16 -16 15 15 anyway"];
    },
  }),
  // ---- the world (docs/09 "A new world")
  "world.seed": define({ name: "world.seed", role: "ADMIN", input: z.object({}), build: () => ["seed"] }),
  "world.save": define({ name: "world.save", role: "ADMIN", input: z.object({}), build: () => ["save-all"] }),
  "world.pregen": define({
    name: "world.pregen",
    role: "ADMIN",
    input: z.object({ x: z.number().int().min(-100_000).max(100_000), z: z.number().int().min(-100_000).max(100_000), radius: z.number().int().min(16).max(10_000) }),
    // `quiet 30`: one line of progress every half minute instead of every second
    build: (_ctx, { x, z, radius }) => ["chunky quiet 30", "chunky world minecraft:overworld", "chunky shape square", `chunky center ${x} ${z}`, `chunky radius ${radius}`, "chunky start"],
  }),
  "world.pregenContinue": define({ name: "world.pregenContinue", role: "ADMIN", input: z.object({}), build: () => ["chunky quiet 30", "chunky continue"] }),
  // chunky asks "are you sure" and wants `confirm`
  "world.pregenCancel": define({ name: "world.pregenCancel", role: "ADMIN", input: z.object({}), build: () => ["chunky cancel", "chunky confirm"] }),
  // Before the server is stopped: a stop in the middle of generating hung at "Saving worlds" (2026-09-29).
  "world.pregenPause": define({ name: "world.pregenPause", role: "ADMIN", input: z.object({}), build: () => ["chunky pause", "save-all flush"] }),
  "world.pregenProgress": define({ name: "world.pregenProgress", role: "ADMIN", input: z.object({}), build: () => ["chunky progress"] }),
  "world.locate": define({
    name: "world.locate",
    role: "ADMIN",
    input: z.object({ what: z.enum(["structure", "biome"]), id: z.string().regex(/^#?[a-z0-9_.-]{1,40}:[a-z0-9_./-]{1,60}$/), x: z.number().int().min(-100_000).max(100_000), z: z.number().int().min(-100_000).max(100_000) }),
    build: (_ctx, { what, id, x, z }) => [`execute in minecraft:overworld positioned ${x} 64 ${z} run locate ${what} ${id}`],
  }),
  // Can someone stand there? Three answers: the block below is not air ("Test failed"), the two above it are ("Test passed").
  // `if` belongs to `execute` itself: no `run` in front of it (the first version had one and the game refused it).
  "world.standable": define({
    name: "world.standable",
    role: "ADMIN",
    input: z.object({ x: z.number().int().min(-100_000).max(100_000), y: z.number().int().min(-63).max(318), z: z.number().int().min(-100_000).max(100_000) }),
    build: (_ctx, { x, y, z }) => [y - 1, y, y + 1].map((h) => `execute in minecraft:overworld if block ${x} ${h} ${z} minecraft:air`),
  }),
  "map.list": define({ name: "map.list", role: "ADMIN", input: z.object({}), build: () => ["bluemap maps"] }),
  "map.purge": define({ name: "map.purge", role: "ADMIN", input: z.object({ map: z.string().regex(/^[a-z0-9_-]{1,40}$/) }), build: (_ctx, { map }) => [`bluemap purge ${map}`] }),
  // With an area: what has changed inside it since it was last rendered. BlueMap renders only chunks that exist.
  "map.update": define({
    name: "map.update",
    role: "ADMIN",
    input: z.object({ map: z.string().regex(/^[a-z0-9_-]{1,40}$/), x: z.number().int().min(-100_000).max(100_000).optional(), z: z.number().int().min(-100_000).max(100_000).optional(), radius: z.number().int().min(16).max(10_000).optional() }),
    build: (_ctx, { map, x, z: zz, radius }) => [radius === undefined ? `bluemap update ${map}` : `bluemap update ${map} ${x ?? 0} ${zz ?? 0} ${radius}`],
  }),
  // docs/13 §13: the admin's inventory editor. Vanilla commands only, built from checked input; only through
  // POST /players/:name/inventory (routes/inventory.ts), which is rate-limited and writes the event log itself.
  "inv.read": define({ name: "inv.read", role: "ADMIN", input: z.object({ player: MC_NAME }), build: (_ctx, { player }) => [`data get entity ${player}`] }),
  "inv.set": define({
    name: "inv.set",
    role: "ADMIN",
    input: z.object({ player: MC_NAME, slot: z.string().regex(SLOT_RE), item: z.string().regex(ITEM_RE), count: z.number().int().min(1).max(99), components: z.string().regex(COMPONENTS_RE).optional() }),
    build: (_ctx, { player, slot, item, count, components }) => [`item replace entity ${player} ${slot} with ${item}${components ?? ""} ${count}`],
  }),
  "inv.clear": define({ name: "inv.clear", role: "ADMIN", input: z.object({ player: MC_NAME, slot: z.string().regex(SLOT_RE) }), build: (_ctx, { player, slot }) => [`item replace entity ${player} ${slot} with air`] }),
  "inv.give": define({
    name: "inv.give",
    role: "ADMIN",
    input: z.object({ player: MC_NAME, item: z.string().regex(ITEM_RE), count: z.number().int().min(1).max(99), components: z.string().regex(COMPONENTS_RE).optional() }),
    build: (_ctx, { player, item, count, components }) => [`give ${player} ${item}${components ?? ""} ${count}`],
  }),
  "inv.notify": define({ name: "inv.notify", role: "ADMIN", input: z.object({ player: MC_NAME }), build: (_ctx, { player }) => [`tellraw ${player} {"text":"An admin changed your inventory.","color":"gray"}`] }),
  // Reads BlueMap's config files again (render threads and the like) without a restart of the server. BlueMap drops
  // its queued renders when it reloads: status/pregen.ts asks for the map again afterwards.
  "map.reload": define({ name: "map.reload", role: "ADMIN", input: z.object({}), build: () => ["bluemap reload"] }),
  // BlueMap keeps "stopped" over a restart of the server: whoever stops it owes it a start (status/pregen.ts does).
  "map.stop": define({ name: "map.stop", role: "ADMIN", input: z.object({}), build: () => ["bluemap stop"] }),
  "map.start": define({ name: "map.start", role: "ADMIN", input: z.object({}), build: () => ["bluemap start"] }),
  "map.status": define({ name: "map.status", role: "ADMIN", input: z.object({}), build: () => ["bluemap"] }),
  // ---- seasons (docs/34 §6, W1.4). The ids come from the season file, checked by the route; never free text.
  // A boss advancement shares itself with whoever stands near (its reward function), unless the player holds the
  // tag dw.credit: an admin grant is for one player, so the tag is put on for the grant and taken off again.
  "season.grant": define({
    name: "season.grant",
    role: "ADMIN",
    input: z.object({ name: MC_NAME, season: SEASON_ID, kind: z.enum(["boss", "trial"]), id: SEASON_ID }),
    build: (_ctx, { name, season, kind, id }) => [`tag ${name} add dw.credit`, `advancement grant ${name} only deepslate:${season}/${kind}/${id}`, `tag ${name} remove dw.credit`],
  }),
  "season.revoke": define({
    name: "season.revoke",
    role: "ADMIN",
    input: z.object({ name: MC_NAME, season: SEASON_ID, kind: z.enum(["boss", "trial"]), id: SEASON_ID }),
    build: (_ctx, { name, season, kind, id }) => [`advancement revoke ${name} only deepslate:${season}/${kind}/${id}`],
  }),
  // Reads every datapack again, the season one among them. On a server with this many mods it can hold the game
  // for some seconds (docs/34 §8, decision 3: timed at the rehearsal).
  "season.reload": define({ name: "season.reload", role: "ADMIN", input: z.object({}), build: () => ["reload"] }),
};

export type ActionName = keyof typeof actions;
/** Admin actions with a route of their own, not reachable through POST /actions/:name. */
export const OWN_ROUTE: ReadonlySet<string> = new Set(["console.send", "inv.read", "inv.set", "inv.clear", "inv.give", "inv.notify", "season.grant", "season.revoke", "season.reload"]);
export const ADMIN_ACTIONS: ActionName[] = (Object.keys(actions) as ActionName[]).filter((n) => actions[n].role === "ADMIN");
