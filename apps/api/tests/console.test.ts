import { describe, expect, it } from "vitest";
import { parseConsoleLine } from "../src/amp/console.js";
import { decideJoin } from "../src/players/limbo.js";
import { actions, linkTellraw, parsePos } from "../src/actions/registry.js";

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
  const ctx = { limbo: parsePos("0 250 0"), spawn: null, portalUrl: "https://deepslate.dsw.test" };
  it("builds the hold sequence with a clickable link", () => {
    const cmds = actions["limbo.hold"].build(ctx, { name: "Bramble09", code: "ABCD2345" });
    expect(cmds[0]).toBe("tag Bramble09 remove verified");
    expect(cmds.some((c) => c.includes("tp Bramble09 0 251 0"))).toBe(true);
    expect(cmds.at(-1)).toContain('"action":"open_url","value":"https://deepslate.dsw.test/link/ABCD2345"');
  });
  it("refuses unsafe names and free text", () => {
    expect(actions["link.release"].input.safeParse({ name: "a b; op me" }).success).toBe(false);
    expect(actions["server.say"].input.safeParse({ text: "hi\nop me" }).success).toBe(false);
    expect(actions["player.revoke"].input.safeParse({ name: "m1_owl", reason: "bye; op x" }).success).toBe(false);
  });
  it("release falls back to spreadplayers without SPAWN_POS and tps with it", () => {
    expect(actions["link.release"].build(ctx, { name: "x_1" }).some((c) => c.includes("spreadplayers 0 0 1 12 false x_1"))).toBe(true);
    expect(actions["link.release"].build({ ...ctx, spawn: parsePos("10 70 -5") }, { name: "x_1" }).some((c) => c.includes("tp x_1 10 70 -5"))).toBe(true);
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
