import { z } from "zod";
import { NOT_OPEN_TEXT } from "../shared/access.js";
import { CODE_RE, showCode } from "../shared/join-code.js";

// docs/08 + docs/14: every console command the api ever sends is built here from validated input.
// "system" actions are run by the api itself (join hook, timers); the rest need an ADMIN caller.

export const MC_NAME = z.string().regex(/^[A-Za-z0-9_]{3,16}$/);
const POS = /^(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)$/;
const DIMENSION = /^[a-z0-9_.-]{1,64}:[a-z0-9_./-]{1,64}$/;

export type Pos = { x: number; y: number; z: number };
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

export type ActionCtx = { limbo: Place; spawn: Pos | null; portalUrl: string; siteName?: string };

export type Action<I> = {
  name: string;
  role: "system" | "ADMIN";
  input: z.ZodType<I>;
  build: (ctx: ActionCtx, input: I) => string[];
};

const define = <I,>(a: Action<I>) => a;

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
];

/** Only what is safe to show in chat: the name comes from a settings page, not from code. */
export const chatSafe = (s: string | undefined, fallback: string) => (s ?? "").replace(/[^\p{L}\p{N} .,'!&()+-]/gu, "").trim().slice(0, 40) || fallback;

const hostOf = (portalUrl: string) => portalUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");

/**
 * The link line: one chat message, all of it clickable (the first part is the parent, the rest inherit its click).
 * Sent again every 15 s while they wait, and at once when they say something (players/limbo.ts), so it is kept to
 * one message: the chat fades after 10 s and would otherwise fill with it.
 */
export function linkTellraw(name: string, portalUrl: string, code: string, siteName?: string): string {
  const url = `${portalUrl}/link/${code}`;
  const host = hostOf(portalUrl);
  const payload = [
    { text: "", clickEvent: { action: "open_url", value: url }, hoverEvent: { action: "show_text", value: `Sign in to ${chatSafe(siteName, "Deepslate Works")}: opens ${host}/link/${code}` } },
    { text: "Click here to sign in", color: "gold", underlined: true },
    { text: `, or go to ${host}/join and enter ${showCode(code)}`, color: "gray" },
  ];
  return `tellraw ${name} ${JSON.stringify(payload)}`;
}

/** Who waits in the room, and for what: to link their Discord, for Play first, for the server to open, or for a new installer. */
export type HeldKind = "link" | "play" | "closed" | "old";

/** What stays on their screen while they wait (docs/14 "The prompt"). */
export function screenText(kind: HeldKind, portalUrl: string, code = ""): { title: string; subtitle: string } {
  const host = hostOf(portalUrl);
  if (kind === "link") return { title: "Sign in to play", subtitle: `Click the link in chat, or go to ${host}/join and enter ${showCode(code)}` };
  if (kind === "play") return { title: "Press Play first", subtitle: `Press Play on ${host} and you'll be let in` };
  if (kind === "old") return { title: "Download Deepslate Works again", subtitle: `from ${host}/install, then press Play` };
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
    `title ${who} actionbar ${component(t.subtitle, "yellow")}`,
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
    { text: "Download Deepslate Works again from ", color: "gold" },
    { text: `${host}/install`, color: "aqua", underlined: true, clickEvent: { action: "open_url", value: url }, hoverEvent: { action: "show_text", value: "Opens the install page in your browser" } },
    { text: ". Run Setup.bat once, then press Play; from then on it keeps itself up to date.", color: "gold" },
  ];
  return `tellraw ${name} ${JSON.stringify(payload)}`;
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
    build: (ctx, { name, code }) => [...intoRoom(ctx, name), ...screenCommands(name, "link", ctx.portalUrl, code), linkTellraw(name, ctx.portalUrl, code, ctx.siteName)],
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
    input: z.object({ name: MC_NAME, kind: z.enum(["link", "play", "closed", "old"]), code: z.string().regex(CODE_RE).optional() }),
    build: (ctx, { name, kind, code }) => [`title @a[name=${name},tag=!verified] actionbar ${component(screenText(kind, ctx.portalUrl, code).subtitle, "yellow")}`],
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
  "limbo.kickIdleOld": define({
    name: "limbo.kickIdleOld",
    role: "system",
    input: z.object({ name: MC_NAME }),
    build: (ctx, { name }) => [`kick ${name} Download Deepslate Works again from ${ctx.portalUrl.replace(/^https?:\/\//, "")}/install and join again.`],
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
    // whoever stands there: the server's name, and where to sign in from a phone (docs/14 "The prompt"). `hollow`
    // empties the inside, so a sign of an earlier build does not stay behind.
    // logAdminCommands off: the room's prompt uses `title` every few seconds, and every `title` sent from the console
    // would otherwise be repeated to each operator in game ("[Server: Showing new title for …]").
    build: (ctx) => {
      const b = roomBounds(ctx.limbo);
      const c = block(ctx.limbo);
      const d = ctx.limbo.dimension;
      const name = chatSafe(ctx.siteName, "Deepslate Works").replace(/'/g, "");
      const line = (t: string) => `'${JSON.stringify({ text: t })}'`;
      const sign = (x: number, lines: string[]) => inDim(d, `setblock ${x} ${c.y} ${c.z - 3} minecraft:oak_sign[rotation=0]{front_text:{messages:[${lines.map(line).join(",")}]},is_waxed:1b}`);
      const host = hostOf(ctx.portalUrl).replace(/'/g, "");
      const dot = host.indexOf(".");
      const where = dot > 0 ? [host.slice(0, dot + 1), `${host.slice(dot + 1)}/join`] : [host, "/join"];
      return [
        inDim(d, `forceload add ${b.x1} ${b.z1} ${b.x2} ${b.z2}`),
        inDim(d, `fill ${b.x1} ${b.y1} ${b.z1} ${b.x2} ${b.y2} ${b.z2} minecraft:glass hollow`),
        inDim(d, `fill ${b.x1} ${b.y1} ${b.z1} ${b.x2} ${b.y1} ${b.z2} minecraft:sea_lantern`),
        sign(c.x - 1, ["", name, "", ""]),
        sign(c.x + 1, ["Sign in at", where[0]!, where[1]!, "code in chat"]),
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
  "server.list": define({ name: "server.list", role: "system", input: z.object({}), build: () => ["list"] }),
  // spark: one player's ping (docs/05 "Connection"). spark has no command for everyone at once.
  "server.pings": define({ name: "server.pings", role: "system", input: z.object({ name: MC_NAME }), build: (_ctx, { name }) => [`spark ping --player ${name}`] }),
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
  // BlueMap keeps "stopped" over a restart of the server: whoever stops it owes it a start (status/pregen.ts does).
  "map.stop": define({ name: "map.stop", role: "ADMIN", input: z.object({}), build: () => ["bluemap stop"] }),
  "map.start": define({ name: "map.start", role: "ADMIN", input: z.object({}), build: () => ["bluemap start"] }),
  "map.status": define({ name: "map.status", role: "ADMIN", input: z.object({}), build: () => ["bluemap"] }),
};

export type ActionName = keyof typeof actions;
export const ADMIN_ACTIONS: ActionName[] = (Object.keys(actions) as ActionName[]).filter((n) => actions[n].role === "ADMIN");
