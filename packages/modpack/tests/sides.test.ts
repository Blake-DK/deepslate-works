import { PassThrough } from "node:stream";
import archiver from "archiver";
import { describe, expect, it } from "vitest";
import type { LockEntry } from "../src/lock";
import { checkSides, clientSet, jarChannels, sideFor, widenForDependents } from "../src/sides";
import { openZip } from "../src/zip";

// 2.1.0 (kanefinch's TaCZ kick, 2026-10-01): anything both sides need is never server-only.

const entry = (slug: string, side: LockEntry["side"], extra: Partial<LockEntry> = {}): LockEntry => ({
  slug, name: slug, projectId: "p-" + slug, versionId: "v", versionNumber: "1", versionType: "release", filename: `${slug}.jar`, url: "https://cdn/x.jar",
  sha512: "0", sha1: "0", size: 1, side, requiredBy: [], ...extra,
});

function zip(files: Record<string, Buffer>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const a = archiver("zip", { store: true });
    const out = new PassThrough();
    const parts: Buffer[] = [];
    out.on("data", (c: Buffer) => parts.push(c));
    out.on("end", () => resolve(Buffer.concat(parts)));
    a.on("error", reject);
    a.pipe(out);
    for (const [name, body] of Object.entries(files)) a.append(body, { name });
    void a.finalize();
  });
}
const REG = "net/neoforged/neoforge/network/registration/PayloadRegistrar";
const cls = (...parts: string[]) => Buffer.from(["Êþº¾", ...parts].join("\u0001"), "latin1");

describe("sideFor", () => {
  it("follows Modrinth when mods.json says nothing", () => {
    expect(sideFor("bluemap", { client_side: "unsupported", server_side: "required" }, undefined)).toBe("server");
    expect(sideFor("sodium", { client_side: "required", server_side: "unsupported" }, "both")).toBe("client");
    expect(sideFor("tacz", { client_side: "required", server_side: "required" }, undefined)).toBe("both");
  });
  it("lets mods.json narrow a mod the client can do without (chunky, spark)", () => {
    expect(sideFor("chunky", { client_side: "optional", server_side: "optional" }, "server")).toBe("server");
  });
  it("refuses server-only for a mod the client requires (TaCZ)", () => {
    expect(() => sideFor("tacz-1.21.1", { client_side: "required", server_side: "required" }, "server")).toThrow(/never server-only/);
  });
  it("refuses client-only for a mod the server requires", () => {
    expect(() => sideFor("create", { client_side: "optional", server_side: "required" }, "client")).toThrow(/server requires it/);
  });
});

describe("widenForDependents", () => {
  it("a library a PC mod needs goes to PCs too", () => {
    const lib = entry("lib", "server", { requiredBy: ["tacz"], modrinth: { client: "optional", server: "optional" } });
    widenForDependents([entry("tacz", "both"), lib]);
    expect(lib.side).toBe("both");
  });
  it("one that cannot run where it is needed is an error", () => {
    expect(() => widenForDependents([entry("tacz", "both"), entry("lib", "server", { requiredBy: ["tacz"], modrinth: { client: "unsupported", server: "required" } })])).toThrow(/does not run on the client/);
  });
  it("leaves a client library of a client mod alone", () => {
    const cfg = entry("craft-config", "client", { requiredBy: ["bettertabinfo"] });
    widenForDependents([entry("bettertabinfo", "client"), cfg]);
    expect(cfg.side).toBe("client");
  });
});

describe("jarChannels", () => {
  it("a class registering payloads without optional(): required (TaCZ's NetworkHandler)", async () => {
    expect(jarChannels(openZip(await zip({ "com/tacz/guns/network/NetworkHandler.class": cls(REG, "acknowledge", "configurationToClient") })))).toBe("required");
  });
  it("only optional() registrations: optional; none at all: none", async () => {
    expect(jarChannels(openZip(await zip({ "a/Net.class": cls(REG, "\u0000\u0008optional") })))).toBe("optional");
    expect(jarChannels(openZip(await zip({ "a/B.class": cls("nothing"), "META-INF/neoforge.mods.toml": Buffer.from("x") })))).toBe("none");
  });
  it("looks into jar-in-jar libraries", async () => {
    const inner = await zip({ "lib/Net.class": cls(REG) });
    expect(jarChannels(openZip(await zip({ "META-INF/jarjar/lib.jar": inner, "a/B.class": cls("x") })))).toBe("required");
  });
});

describe("checkSides", () => {
  const lock = { files: [entry("tacz-1.21.1", "both", { modrinth: { client: "required", server: "required" }, channels: "required" }), entry("chunky", "server", { modrinth: { client: "optional", server: "optional" }, channels: "none" }), entry("sodium", "client")] };
  it("the pack as it is: no problems; PCs get everything but server-only", () => {
    expect(checkSides(lock, null)).toEqual([]);
    expect(clientSet(lock).map((f) => f.slug)).toEqual(["tacz-1.21.1", "sodium"]);
  });
  it("TaCZ marked server-only: two problems (Modrinth and its channels)", () => {
    const bad = { files: lock.files.map((f) => (f.slug === "tacz-1.21.1" ? { ...f, side: "server" as const } : f)) };
    expect(checkSides(bad, null).map((p) => p.why)).toEqual(["server-only, but Modrinth says the client requires it", "server-only, but it registers network channels PCs must have"]);
  });
  it("a jar the server loaded that the lock does not know is flagged; nested jars and NeoForge itself are not", () => {
    const loaded = { at: "2026-10-01T15:14:00Z", source: "logs/latest.log", files: [{ filename: "tacz-1.21.1.jar" }, { filename: "chunky.jar" }, { filename: "ponder.jar", nested: true }, { filename: "neoforge-21.1.252-universal.jar" }, { filename: "mystery.jar" }] };
    expect(checkSides(lock, loaded).map((p) => p.filename)).toEqual(["mystery.jar"]);
  });
});
