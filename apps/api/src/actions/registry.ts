import { z } from "zod";

// docs/08 + docs/14: every console command the api ever sends is built here from validated input.
// "system" actions are run by the api itself (join hook, timers); the rest need an ADMIN caller.

export const MC_NAME = z.string().regex(/^[A-Za-z0-9_]{3,16}$/);
const POS = /^(-?\d+) (-?\d+) (-?\d+)$/;

export type Pos = { x: number; y: number; z: number };
export function parsePos(s: string): Pos {
  const m = POS.exec(s);
  if (!m) throw new Error(`bad position "${s}"`);
  return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
}

export type ActionCtx = { limbo: Pos; spawn: Pos | null; portalUrl: string; siteName?: string };

export type Action<I> = {
  name: string;
  role: "system" | "ADMIN";
  input: z.ZodType<I>;
  build: (ctx: ActionCtx, input: I) => string[];
};

const define = <I,>(a: Action<I>) => a;

// The room: a bedrock box 11 wide, 7 high, 11 long centred on LIMBO_POS; players stand at y+1.
const roomBounds = (c: Pos) => ({ x1: c.x - 5, y1: c.y - 1, z1: c.z - 5, x2: c.x + 5, y2: c.y + 5, z2: c.z + 5 });
const inside = (c: Pos) => `x=${c.x - 4},y=${c.y},z=${c.z - 4},dx=8,dy=5,dz=8`;
const ow = (cmd: string) => `execute in minecraft:overworld run ${cmd}`;

/** Only what is safe to show in chat: the name comes from a settings page, not from code. */
export const chatSafe = (s: string | undefined, fallback: string) => (s ?? "").replace(/[^\p{L}\p{N} .,'!&()+-]/gu, "").trim().slice(0, 40) || fallback;

export function linkTellraw(name: string, portalUrl: string, code: string, siteName?: string): string {
  const url = `${portalUrl}/link/${code}`;
  const short = url.replace(/^https?:\/\//, "");
  const payload = [
    "",
    { text: `Welcome to ${chatSafe(siteName, "Deepslate Works")}. Click to link your Discord: `, color: "gold" },
    { text: short, color: "aqua", underlined: true, clickEvent: { action: "open_url", value: url }, hoverEvent: { action: "show_text", value: "Opens the portal in your browser" } },
    { text: `  (or open the site and enter ${code})`, color: "gray" },
  ];
  return `tellraw ${name} ${JSON.stringify(payload)}`;
}

const COORD = z.number().finite().min(-30_000_000).max(30_000_000);

export function playTellraw(name: string, portalUrl: string): string {
  const host = portalUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const payload = [
    "",
    { text: "Press Play on ", color: "gold" },
    { text: host, color: "aqua", underlined: true, clickEvent: { action: "open_url", value: portalUrl }, hoverEvent: { action: "show_text", value: "Opens the portal in your browser" } },
    { text: " to join. That checks your mods are up to date.", color: "gold" },
  ];
  return `tellraw ${name} ${JSON.stringify(payload)}`;
}

export const actions = {
  "limbo.hold": define({
    name: "limbo.hold",
    role: "system",
    input: z.object({ name: MC_NAME, code: z.string().regex(/^[A-Z0-9]{8}$/) }),
    build: (ctx, { name, code }) => [
      `tag ${name} remove verified`,
      `gamemode adventure ${name}`,
      ow(`tp ${name} ${ctx.limbo.x} ${ctx.limbo.y + 1} ${ctx.limbo.z}`),
      `effect give ${name} minecraft:slowness infinite 255 true`,
      `effect give ${name} minecraft:jump_boost infinite 250 true`,
      linkTellraw(name, ctx.portalUrl, code, ctx.siteName),
    ],
  }),
  "limbo.remind": define({
    name: "limbo.remind",
    role: "system",
    input: z.object({ name: MC_NAME, code: z.string().regex(/^[A-Z0-9]{8}$/) }),
    build: (ctx, { name, code }) => [linkTellraw(name, ctx.portalUrl, code, ctx.siteName)],
  }),
  "limbo.keep": define({
    name: "limbo.keep",
    role: "system",
    input: z.object({}),
    build: (ctx) => [ow(`execute as @a[tag=!verified] at @s unless entity @s[${inside(ctx.limbo)}] run tp @s ${ctx.limbo.x} ${ctx.limbo.y + 1} ${ctx.limbo.z}`)],
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
    build: (ctx, { name }) => [
      `tag ${name} remove verified`,
      `gamemode adventure ${name}`,
      ow(`tp ${name} ${ctx.limbo.x} ${ctx.limbo.y + 1} ${ctx.limbo.z}`),
      `effect give ${name} minecraft:slowness infinite 255 true`,
      `effect give ${name} minecraft:jump_boost infinite 250 true`,
      playTellraw(name, ctx.portalUrl),
    ],
  }),
  "limbo.remindPlay": define({
    name: "limbo.remindPlay",
    role: "system",
    input: z.object({ name: MC_NAME }),
    build: (ctx, { name }) => [playTellraw(name, ctx.portalUrl)],
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
        `tag ${name} add verified`,
      ];
    },
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
    build: (ctx) => {
      const b = roomBounds(ctx.limbo);
      const c = ctx.limbo;
      return [
        ow(`forceload add ${b.x1} ${b.z1} ${b.x2} ${b.z2}`),
        ow(`fill ${b.x1} ${b.y1} ${b.z1} ${b.x2} ${b.y2} ${b.z2} minecraft:bedrock`),
        ow(`fill ${b.x1 + 1} ${b.y1 + 1} ${b.z1 + 1} ${b.x2 - 1} ${b.y2 - 1} ${b.z2 - 1} minecraft:air`),
        ow(`fill ${b.x1 + 1} ${b.y1 + 1} ${b.z1 + 1} ${b.x2 - 1} ${b.y1 + 1} ${b.z2 - 1} minecraft:smooth_stone`),
        ...[[b.x1 + 1, b.z1 + 1], [b.x2 - 1, b.z1 + 1], [b.x1 + 1, b.z2 - 1], [b.x2 - 1, b.z2 - 1]].map(([x, z]) => ow(`setblock ${x} ${b.y2 - 1} ${z} minecraft:glowstone`)),
        ow(`setblock ${c.x} ${b.y2 - 1} ${c.z} minecraft:sea_lantern`),
      ];
    },
  }),
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
  "map.update": define({ name: "map.update", role: "ADMIN", input: z.object({ map: z.string().regex(/^[a-z0-9_-]{1,40}$/) }), build: (_ctx, { map }) => [`bluemap update ${map}`] }),
  "map.status": define({ name: "map.status", role: "ADMIN", input: z.object({}), build: () => ["bluemap"] }),
};

export type ActionName = keyof typeof actions;
export const ADMIN_ACTIONS: ActionName[] = (Object.keys(actions) as ActionName[]).filter((n) => actions[n].role === "ADMIN");
