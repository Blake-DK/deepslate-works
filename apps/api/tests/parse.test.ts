import { describe, expect, it } from "vitest";
import { ipOf, parse, redact, reduce } from "../src/events/parse.js";

// Lines in the log-file shape were captured from the instance on 2026-09-28/29 (names swapped where a
// line had none of ours); the AMP-entry shape is the same message with the prefix in `source`.
const L = (msg: string, thread = "Server thread", level = "INFO", logger = "net.minecraft.server.MinecraftServer/") => `[29Sep2026 03:46:07.132] [${thread}/${level}] [${logger}]: ${msg}`;

describe("reduce", () => {
  it("strips the NeoForge log prefix", () => {
    expect(reduce(L('Done (1.756s)! For help, type "help"', "Server thread", "INFO", "net.minecraft.server.dedicated.DedicatedServer/"))).toEqual({ message: 'Done (1.756s)! For help, type "help"', level: "INFO", logger: "net.minecraft.server.dedicated.DedicatedServer", thread: "Server thread" });
  });
  it("strips the vanilla prefix and the short one", () => {
    expect(reduce("[19:49:10] [User Authenticator #1/INFO] [minecraft/ServerLoginPacketListenerImpl]: UUID of player Bramble09 is c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10").message).toBe("UUID of player Bramble09 is c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10");
    expect(reduce("[19:49:10] [Server thread/INFO]: Bramble09 joined the game").message).toBe("Bramble09 joined the game");
  });
  it("takes the level from AMP's Source when the message has no prefix", () => {
    expect(reduce("Can't keep up! Is the server overloaded?", { source: "Server thread/WARN", type: "Console" })).toMatchObject({ message: "Can't keep up! Is the server overloaded?", level: "WARN", thread: "Server thread" });
  });
  it("leaves [Server] and [Not Secure] alone: they are part of the message", () => {
    expect(reduce(L("[Server] hello")).message).toBe("[Server] hello");
    expect(reduce(L("[Not Secure] <Bramble09> hi")).message).toBe("[Not Secure] <Bramble09> hi");
  });
});

describe("parse", () => {
  it("reads the login line with its address, in both shapes", () => {
    expect(parse(L("Bramble09[/10.0.0.5:51234] logged in with entity id 123 at (12.5, 64.0, -3.5)", "Server thread", "INFO", "net.minecraft.server.players.PlayerList/"))).toEqual([{ type: "join", name: "Bramble09", ip: "10.0.0.5" }]);
    expect(parse("Bramble09[/[2a01:4b00::1]:51234] logged in with entity id 5 at (0, 64, 0)", { source: "Server thread/INFO", type: "Console" })).toEqual([{ type: "join", name: "Bramble09", ip: "2a01:4b00::1" }]);
    expect(parse(L("m1_owl[local] logged in with entity id 9 at (0, 64, 0)"))).toEqual([{ type: "join", name: "m1_owl", ip: null }]);
  });
  it("reads uuid, joined, left, lost connection and list", () => {
    expect(parse(L("UUID of player Bramble09 is C50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10", "User Authenticator #1"))).toEqual([{ type: "uuid", name: "Bramble09", uuid: "c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10" }]);
    expect(parse(L("Bramble09 joined the game"))).toEqual([{ type: "join", name: "Bramble09", ip: null }]);
    expect(parse("Bramble09 left the game", { source: "Server thread/INFO" })).toEqual([{ type: "leave", name: "Bramble09", reason: null }]);
    expect(parse(L("m1_owl lost connection: Disconnected"))).toEqual([{ type: "leave", name: "m1_owl", reason: "Disconnected" }]);
    expect(parse(L("There are 2 of a max of 20 players online: Bramble09, m1_owl"))).toEqual([{ type: "list", online: 2, max: 20, names: ["Bramble09", "m1_owl"] }]);
    expect(parse(L("There are 0 of a max of 20 players online: "))).toEqual([{ type: "list", online: 0, max: 20, names: [] }]);
  });
  it("reads chat, and chat can never pass for anything else", () => {
    expect(parse(L("<Bramble09> hello there"))).toEqual([{ type: "chat", name: "Bramble09", text: "hello there" }]);
    expect(parse(L("[Not Secure] <Bramble09> hello"))).toEqual([{ type: "chat", name: "Bramble09", text: "hello" }]);
    for (const trick of ["hax joined the game", "m1_owl left the game", "Bramble09 was slain by Zombie", 'Done (1.0s)! For help, type "help"', "UUID of player hax is c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10", "Stopping server"]) {
      expect(parse(L(`<Bramble09> ${trick}`)).map((e) => e.type)).toEqual(["chat"]);
      expect(parse(trick, { source: "Bramble09", type: "Chat" })).toEqual([{ type: "chat", name: "Bramble09", text: trick }]);
    }
  });
  it("ignores what the console or a command block says", () => {
    expect(parse(L("[Server] Bramble09 joined the game"))).toEqual([]);
    expect(parse(L("[Rcon] m1_owl left the game"))).toEqual([]);
    expect(parse(L("[Bramble09: Set own game mode to Creative Mode]"))).toEqual([]);
  });
  it("reads deaths, only for players", () => {
    const players = (n: string) => ["Bramble09", "m1_owl"].includes(n);
    for (const [line, text] of [
      ["Bramble09 was slain by Zombie", "was slain by Zombie"],
      ["Bramble09 was shot by Skeleton using [Bow of Doom]", "was shot by Skeleton using [Bow of Doom]"],
      ["m1_owl fell from a high place", "fell from a high place"],
      ["m1_owl hit the ground too hard whilst trying to escape Creeper", "hit the ground too hard whilst trying to escape Creeper"],
      ["m1_owl drowned", "drowned"],
      ["Bramble09 tried to swim in lava", "tried to swim in lava"],
      ["Bramble09 blew up", "blew up"],
      ["Bramble09 was blown up by Creeper", "was blown up by Creeper"],
      ["Bramble09 died", "died"],
      ["Bramble09 withered away", "withered away"],
      ["Bramble09 didn't want to live in the same world as Warden", "didn't want to live in the same world as Warden"],
    ] as const) {
      expect(parse(L(line), {}, players)).toEqual([{ type: "death", name: line.split(" ")[0], text }]);
    }
    expect(parse(L("Villager was slain by Zombie"), {}, players)).toEqual([]);
    expect(parse(L("Bramble09 fell asleep"), {}, players)).toEqual([]);
    expect(parse(L("Bramble09 was given 3 diamonds"), {}, players)).toEqual([]);
  });
  it("reads advancements", () => {
    expect(parse(L("Bramble09 has made the advancement [Stone Age]"))).toEqual([{ type: "advancement", name: "Bramble09", how: "advancement", title: "Stone Age" }]);
    expect(parse(L("m1_owl has completed the challenge [How Did We Get Here?]"))).toEqual([{ type: "advancement", name: "m1_owl", how: "challenge", title: "How Did We Get Here?" }]);
    expect(parse(L("m1_owl has reached the goal [Sky's the Limit]"))).toEqual([{ type: "advancement", name: "m1_owl", how: "goal", title: "Sky's the Limit" }]);
  });
  it("reads start and stop (real lines)", () => {
    expect(parse('[29Sep2026 03:46:07.132] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer/]: Done (1.756s)! For help, type "help"')).toEqual([{ type: "started", seconds: 1.756 }]);
    expect(parse("[29Sep2026 03:51:01.024] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: Stopping server")).toEqual([{ type: "stopping" }]);
    // the stop command's answer, what AMP's stop and its sleep write first (2026-09-29 17:02): a clean stop too
    expect(parse("[29Sep2026 03:51:00.534] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: Stopping the server")).toEqual([{ type: "stopping" }]);
  });
  it("reports warnings and errors, but not the mod loader's start-up noise (real lines)", () => {
    expect(parse(L("Can't keep up! Is the server overloaded? Running 2500ms or 50 ticks behind", "Server thread", "WARN"))).toEqual([{ type: "problem", level: "WARN", text: "Can't keep up! Is the server overloaded? Running 2500ms or 50 ticks behind", logger: "net.minecraft.server.MinecraftServer" }]);
    expect(parse(L("Encountered an unexpected exception", "Server thread", "ERROR"))).toMatchObject([{ type: "problem", level: "ERROR" }]);
    expect(parse("Exception in server tick loop", { source: "Server thread/FATAL" })).toMatchObject([{ type: "problem", level: "ERROR" }]);
    for (const noise of [
      "[29Sep2026 03:45:56.130] [main/WARN] [mixin/]: Reference map '${refmap_target}refmap.json' for ferritecore.predicates.mixin.json could not be read. If this is a development environment you can ignore this message",
      "[29Sep2026 03:45:59.237] [main/WARN] [mixin/]: Method overwrite conflict for getTemperature in modernfix-modernfix.mixins.json:perf.remove_biome_temperature_cache.BiomeMixin from mod modernfix, previously written by net.caffeinemc",
      "[28Sep2026 19:49:12.655] [main/WARN] [net.minecraft.server.dedicated.DedicatedServerProperties/]: Failed to parse level-type default, defaulting to minecraft:normal",
      "[29Sep2026 03:46:05.063] [main/WARN] [ModernFix/]: Initial datapack load took 1.984 s",
      "[29Sep2026 03:46:07.580] [Server thread/WARN] [ModernFix/]: Dedicated server took 14.379 seconds to load",
      "[28Sep2026 19:46:54.582] [main/WARN] [net.minecraft.server.Eula/]: Failed to load eula.txt",
      "[30Sep2026 19:06:45.101] [modloading-worker-0/WARN] [mixin/]: Discarding @Unique public method useItemOn in copycats-neoforge.mixins.json:foundation.copycat.CopycatBlockMixin from mod copycats because it already exists in com.copycatsplus.copycats.content.copycat.slab.CopycatSlabBlock",
    ]) expect(parse(noise)).toEqual([]);
    expect(parse(L("\tat net.minecraft.server.MinecraftServer.run(MinecraftServer.java:1)", "Server thread", "ERROR"))).toEqual([]);
    // a recipe a mod ships broken is still reported (Create Deco 2.1.3, 2026-09-30)
    expect(parse("[30Sep2026 19:06:49.677] [main/ERROR] [net.minecraft.world.item.crafting.RecipeManager/]: Parsing error loading recipe createdeco:placard: com.google.gson.JsonParseException: Failed to parse either.")).toMatchObject([{ type: "problem", level: "ERROR" }]);
  });
  it("says nothing about ordinary lines", () => {
    expect(parse(L("Preparing spawn area: 84%", "Worker-Main-3", "INFO", "net.minecraft.server.level.progress.LoggerChunkProgressListener/"))).toEqual([]);
    expect(parse("")).toEqual([]);
  });
});

describe("addresses", () => {
  it("takes the ip out of an endpoint", () => {
    expect(ipOf("10.0.0.5:51234")).toBe("10.0.0.5");
    expect(ipOf("[2a01::1]:25565")).toBe("2a01::1");
    expect(ipOf("local")).toBeNull();
  });
  it("hides addresses in the raw line kept with an event", () => {
    expect(redact("Bramble09[/82.10.20.30:51234] logged in with entity id 1")).toBe("Bramble09[address hidden] logged in with entity id 1");
    expect(redact("x[/[2a01::1]:51234] logged in")).toBe("x[address hidden] logged in");
    expect(redact("<Bramble09> meet at [12, 64, -3]")).toBe("<Bramble09> meet at [12, 64, -3]");
  });
});
