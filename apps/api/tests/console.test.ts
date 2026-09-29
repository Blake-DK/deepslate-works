import { describe, expect, it } from "vitest";
import { parseConsoleLine } from "../src/amp/console.js";
import { decideJoin } from "../src/players/limbo.js";
import { actions, linkTellraw, parsePlace, parsePos, roomBounds } from "../src/actions/registry.js";

describe("parseConsoleLine", () => {
  it("reads uuid, login, join, leave and list lines", () => {
    expect(parseConsoleLine("[19:49:10] [User Authenticator #1/INFO] [minecraft/ServerLoginPacketListenerImpl]: UUID of player Bramble09 is c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10")).toContainEqual({ type: "uuid", name: "Bramble09", uuid: "c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10" });
    expect(parseConsoleLine("[19:49:11] [Server thread/INFO] [minecraft/PlayerList]: Bramble09[/10.0.0.5:51234] logged in with entity id 123 at (12.5, 64.0, -3.5)")).toContainEqual({ type: "join", name: "Bramble09", ip: "10.0.0.5" });
    expect(parseConsoleLine("[19:49:11] [Server thread/INFO] [minecraft/MinecraftServer]: Bramble09 joined the game")).toContainEqual({ type: "join", name: "Bramble09", ip: null });
    expect(parseConsoleLine("[19:55:00] [Server thread/INFO] [minecraft/MinecraftServer]: Bramble09 left the game")).toContainEqual({ type: "leave", name: "Bramble09", reason: null });
    expect(parseConsoleLine("[19:55:00] [Server thread/INFO] [minecraft/ServerGamePacketListenerImpl]: m1_owl lost connection: Disconnected")).toContainEqual({ type: "leave", name: "m1_owl", reason: "Disconnected" });
    expect(parseConsoleLine("[19:56:00] [Server thread/INFO] [minecraft/MinecraftServer]: There are 2 of a max of 20 players online: Bramble09, m1_owl")).toContainEqual({ type: "list", online: 2, max: 20, names: ["Bramble09", "m1_owl"] });
  });
  it("ignores chat that mimics a join", () => {
    const ev = parseConsoleLine("[19:57:00] [Server thread/INFO] [minecraft/MinecraftServer]: <Bramble09> hax joined the game");
    expect(ev.some((e) => e.type === "join")).toBe(false);
  });
});

describe("decideJoin", () => {
  it("releases linked members and holds everyone else", () => {
    expect(decideJoin(null).action).toBe("hold");
    expect(decideJoin({ verifiedAt: null, guildMember: true }).action).toBe("hold");
    expect(decideJoin({ verifiedAt: new Date(), guildMember: false }).action).toBe("hold");
    expect(decideJoin({ verifiedAt: new Date(), guildMember: true }).action).toBe("release");
  });
});

describe("actions", () => {
  const ctx = { limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: null, portalUrl: "https://deepslate.dsw.test" };
  it("builds the hold sequence with a clickable link", () => {
    const cmds = actions["limbo.hold"].build(ctx, { name: "Bramble09", code: "ABCD2345" });
    expect(cmds[0]).toBe("tag Bramble09 remove verified");
    expect(cmds.some((c) => c === "execute in deepslate:limbo run tp Bramble09 0.5 65 0.5")).toBe(true);
    expect(cmds.at(-1)).toContain('"action":"open_url","value":"https://deepslate.dsw.test/link/ABCD2345"');
  });
  it("refuses unsafe names and free text", () => {
    expect(actions["link.release"].input.safeParse({ name: "a b; op me" }).success).toBe(false);
    expect(actions["server.say"].input.safeParse({ text: "hi\nop me" }).success).toBe(false);
    expect(actions["player.revoke"].input.safeParse({ name: "m1_owl", reason: "bye; op x" }).success).toBe(false);
  });
  it("release falls back to spreadplayers without SPAWN_POS and tps with it", () => {
    expect(actions["link.release"].build(ctx, { name: "x_1" }).some((c) => c.includes("spreadplayers 0 0 1 12 false @a[name=x_1,tag=!verified]"))).toBe(true);
    expect(actions["link.release"].build({ ...ctx, spawn: parsePos("10 70 -5") }, { name: "x_1" }).some((c) => c.includes("tp @a[name=x_1,tag=!verified] 10 70 -5"))).toBe(true);
  });
  it("a release moves, resets and greets only someone who is held, and marks them last", () => {
    const cmds = actions["link.release"].build(ctx, { name: "x_1" });
    const touching = cmds.filter((c) => /\b(tp|spreadplayers|gamemode|effect|tellraw)\b/.test(c));
    expect(touching.length).toBe(4);
    expect(touching.every((c) => c.includes("@a[name=x_1,tag=!verified]"))).toBe(true);
    expect(cmds[cmds.length - 1]).toBe("tag x_1 add verified");
    expect(cmds).toContain("whitelist add x_1");
  });
  it("welcomes with the name from Admin > Branding, stripped of anything that could break the chat line", () => {
    expect(linkTellraw("p", "https://deepslate.dsw.test", "ABCD2345", "The Mine")).toContain('"text":"Welcome to The Mine. Click to link your Discord: "');
    expect(linkTellraw("p", "https://deepslate.dsw.test", "ABCD2345")).toContain("Welcome to Deepslate Works.");
    const odd = linkTellraw("p", "https://deepslate.dsw.test", "ABCD2345", 'X"},{"text":"pwn","clickEvent":{"action":"run_command","value":"/op p"}} \n§k');
    expect(JSON.parse(odd.slice("tellraw p ".length))).toHaveLength(4);
    expect(odd).not.toContain("run_command");
    expect(odd).not.toContain("§");
    expect(actions["limbo.hold"].build({ ...ctx, siteName: "Blake & Co" }, { name: "Bramble09", code: "ABCD2345" }).at(-1)).toContain("Welcome to Blake & Co.");
  });
  it("tellraw keeps the code visible as a fallback", () => {
    expect(linkTellraw("p", "https://deepslate.dsw.test", "ABCD2345")).toContain("enter ABCD2345");
  });
});

describe("the entrance room in a dimension of its own (docs/14)", () => {
  const ctx = { limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: parsePos("0 105 0"), portalUrl: "https://deepslate.dsw.test", siteName: "Deepslate Works" };
  it("reads where people stand, with or without a dimension", () => {
    expect(parsePlace("deepslate:limbo 0.5 65 0.5")).toEqual({ dimension: "deepslate:limbo", x: 0.5, y: 65, z: 0.5 });
    expect(parsePlace("0 250 0")).toEqual({ dimension: "minecraft:overworld", x: 0, y: 250, z: 0 });
    expect(() => parsePlace("deepslate:limbo run op x 0 65 0")).toThrow();
    expect(() => parsePlace("Deepslate:Limbo 0 65 0")).toThrow();
  });
  it("holds in the room's dimension, in adventure mode", () => {
    const cmds = actions["limbo.hold"].build(ctx, { name: "Bramble09", code: "ABCD2345" });
    expect(cmds).toContain("execute in deepslate:limbo run tp Bramble09 0.5 65 0.5");
    expect(cmds).toContain("gamemode adventure Bramble09");
    expect(actions["limbo.holdPlay"].build(ctx, { name: "Bramble09" })).toContain("execute in deepslate:limbo run tp Bramble09 0.5 65 0.5");
  });
  it("lets out into the overworld, at spawn, in survival mode", () => {
    const cmds = actions["link.release"].build(ctx, { name: "Bramble09" });
    expect(cmds).toContain("execute in minecraft:overworld run tp @a[name=Bramble09,tag=!verified] 0 105 0");
    expect(cmds).toContain("gamemode survival @a[name=Bramble09,tag=!verified]");
  });
  it("puts a member who had not pressed Play back where they stood, in the dimension they were in", () => {
    expect(actions["limbo.releaseBack"].build(ctx, { name: "Bramble09", back: { dimension: "minecraft:the_nether", x: 10.5, y: 70, z: -3.25 } })).toContain("execute in minecraft:the_nether run tp @a[name=Bramble09,tag=!verified] 10.50 70.00 -3.25");
  });
  it("brings back whoever waits and is in another dimension, or in the room's but outside the room", () => {
    expect(actions["limbo.keep"].build(ctx, {})).toEqual([
      "execute as @a[tag=!verified] at @s unless dimension deepslate:limbo in deepslate:limbo run tp @s 0.5 65 0.5",
      "execute as @a[tag=!verified] at @s if dimension deepslate:limbo unless entity @s[x=-4,y=65,z=-4,dx=8,dy=4,dz=8] run tp @s 0.5 65 0.5",
    ]);
  });
  it("is glass, with a floor of sea lanterns under the feet and a sign with the server's name, the size it always was", () => {
    expect(roomBounds(ctx.limbo)).toEqual({ x1: -5, y1: 64, z1: -5, x2: 5, y2: 70, z2: 5 });
    expect(actions["limbo.build"].build({ ...ctx, siteName: "Alex's Works" }, {})).toEqual([
      "execute in deepslate:limbo run forceload add -5 -5 5 5",
      "execute in deepslate:limbo run fill -5 64 -5 5 70 5 minecraft:glass hollow",
      "execute in deepslate:limbo run fill -5 64 -5 5 64 5 minecraft:sea_lantern",
      `execute in deepslate:limbo run setblock 0 65 -3 minecraft:oak_sign[rotation=0]{front_text:{messages:['{"text":""}','{"text":"Alexs Works"}','{"text":""}','{"text":""}']},is_waxed:1b}`,
    ]);
  });
  it("clears the room of before, the same box it was built as, and never the one that is in use", () => {
    expect(actions["limbo.clear"].build(ctx, { dimension: "minecraft:overworld", x: 0, y: 250, z: 0 })).toEqual(["execute in minecraft:overworld run fill -5 249 -5 5 255 5 minecraft:air", "execute in minecraft:overworld run forceload remove -5 -5 5 5"]);
    expect(actions["limbo.clear"].build(ctx, { dimension: "deepslate:limbo", x: 0, y: 65, z: 0 })).toEqual([]);
    expect(actions["limbo.clear"].input.safeParse({ dimension: "minecraft:overworld run stop", x: 0, y: 250, z: 0 }).success).toBe(false);
  });
});
