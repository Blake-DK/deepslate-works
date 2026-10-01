import { describe, expect, it } from "vitest";
import { parse, refusedFor } from "../src/events/parse";
import { compareLoaded, parseLoadedMods } from "../src/modpack/server-mods";
import { doorReason, waitFor } from "../src/players/limbo";
import { screenText } from "../src/actions/registry";

// 2.1.0 (kanefinch's TaCZ kick, 2026-10-01)
const KICK = "Channel of mod 'Timeless & Classics Guns: Zero' failed to connect: This channel is missing on the client side, but required on the server (tacz:acknowledge) [+1 more]";

describe("the handshake refusal", () => {
  it("names the mod and the channel", () => {
    expect(refusedFor(KICK)).toEqual({ mod: "Timeless & Classics Guns: Zero", channel: "tacz:acknowledge" });
    expect(refusedFor("Disconnected")).toBeNull();
    expect(refusedFor("neoforge.network.negotiation.failure.missing.client.server")).toEqual({ mod: null, channel: null });
  });
  it("the same words without the UUID: a refusal and a leave; any other lost connection: a leave", () => {
    expect(parse(`kanefinch lost connection: ${KICK}`).map((e) => e.type)).toEqual(["refused", "leave"]);
    expect(parse("kanefinch lost connection: Disconnected").map((e) => e.type)).toEqual(["leave"]);
  });
});

describe("what the server loaded", () => {
  const log = [
    '[01Oct2026 15:14:01.000] [main/INFO] [net.neoforged.fml.loading.moddiscovery.ModDiscoverer/SCAN]: Found mod file "tacz-neoforge-1.21.1-1.1.8-hotfix-r7.jar" of type MOD with provider net.neoforged.fml.loading.moddiscovery.locators.ModsFolderLocator@1',
    '[01Oct2026 15:14:01.000] [main/INFO] [x/SCAN]: Found mod file "simplebedrockmodel-2.2.1.jar" of type MOD with provider net.neoforged.fml.loading.moddiscovery.locators.JarInJarDependencyLocator@2',
    '[01Oct2026 15:14:01.000] [main/INFO] [x/SCAN]: Found mod file "Chunky-NeoForge-1.4.23.jar" of type MOD with provider ModsFolderLocator',
    '[01Oct2026 15:14:01.000] [main/INFO] [x/SCAN]: Found mod file "secret-server-mod.jar" of type MOD with provider ModsFolderLocator',
  ].join("\n");
  const lock = { files: [
    { slug: "tacz-1.21.1", name: "TaCZ", filename: "tacz-neoforge-1.21.1-1.1.8-hotfix-r7.jar", side: "both", channels: "required", modrinth: { client: "required", server: "required" } },
    { slug: "chunky", name: "Chunky", filename: "Chunky-NeoForge-1.4.23.jar", side: "server", channels: "none", modrinth: { client: "optional", server: "optional" } },
  ] };
  it("reads the mod files, nested ones marked", () => {
    expect(parseLoadedMods(log)).toEqual([
      { filename: "tacz-neoforge-1.21.1-1.1.8-hotfix-r7.jar", nested: false },
      { filename: "simplebedrockmodel-2.2.1.jar", nested: true },
      { filename: "Chunky-NeoForge-1.4.23.jar", nested: false },
      { filename: "secret-server-mod.jar", nested: false },
    ]);
  });
  it("flags a loaded jar no PC gets, and TaCZ if it were server-only", () => {
    expect(compareLoaded(parseLoadedMods(log), lock).map((p) => p.filename)).toEqual(["secret-server-mod.jar"]);
    const bad = { files: lock.files.map((f) => (f.slug === "tacz-1.21.1" ? { ...f, side: "server" } : f)) };
    expect(compareLoaded(parseLoadedMods(log), bad).map((p) => p.slug)).toEqual(["tacz-1.21.1", null]);
  });
  it("the same words without the UUID: a refusal and a leave; any other lost connection: a leave", () => {
    expect(parse(`kanefinch lost connection: ${KICK}`).map((e) => e.type)).toEqual(["refused", "leave"]);
    expect(parse("kanefinch lost connection: Disconnected").map((e) => e.type)).toEqual(["leave"]);
  });
});

describe("the door with missing mods", () => {
  const player = { role: "PLAYER" as const, earlyAccess: true };
  const now = new Date("2026-10-01T18:00:00Z");
  const run = { at: new Date("2026-10-01T17:55:00Z"), packVersion: "0.1.0+af76cd89", installerVersion: "2.1.0" };
  it("holds them with the missing-mods words, which Play clears", () => {
    expect(doorReason(player, { live: true, requirePlay: true, windowMin: 30, run, pack: "0.1.0+af76cd89", now, modsMissing: true })).toBe("missing mods");
    expect(doorReason(player, { live: true, requirePlay: true, windowMin: 30, run, pack: "0.1.0+af76cd89", now, modsMissing: false })).toBeNull();
    expect(waitFor("missing mods")).toBe("mods");
    expect(screenText("mods", "https://deepslate.dsw.test")).toEqual({ title: "Your game is missing some mods", subtitle: "Press Play on deepslate.dsw.test to fix it" });
  });
  it("admins are never held", () => {
    expect(doorReason({ role: "ADMIN" }, { live: true, requirePlay: true, windowMin: 30, run, pack: null, now, modsMissing: true })).toBeNull();
  });
  it("the same words without the UUID: a refusal and a leave; any other lost connection: a leave", () => {
    expect(parse(`kanefinch lost connection: ${KICK}`).map((e) => e.type)).toEqual(["refused", "leave"]);
    expect(parse("kanefinch lost connection: Disconnected").map((e) => e.type)).toEqual(["leave"]);
  });
});

describe("console lines", () => {
  it("a refusal at the handshake (configuration phase, with the UUID) is a refusal, not a leave", () => {
    const ev = parse(`kanefinch (0f6c2b8e-1d2c-4b44-9a7e-6b3d1d0b1f2a) lost connection: ${KICK}`);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: "refused", name: "kanefinch", uuid: "0f6c2b8e-1d2c-4b44-9a7e-6b3d1d0b1f2a", mod: "Timeless & Classics Guns: Zero", channel: "tacz:acknowledge" });
  });
  it("the same words without the UUID: a refusal and a leave; any other lost connection: a leave", () => {
    expect(parse(`kanefinch lost connection: ${KICK}`).map((e) => e.type)).toEqual(["refused", "leave"]);
    expect(parse("kanefinch lost connection: Disconnected").map((e) => e.type)).toEqual(["leave"]);
  });
});
