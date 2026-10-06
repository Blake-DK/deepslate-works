import { describe, expect, it } from "vitest";
import type { LockFile } from "../src/lock";
import { lockReasons, pendingHeadline, pendingSteps, type PendingFacts, uploadsSinceBuild } from "../src/pending";
import type { Manifest } from "../src/schema";

// Alex, 2026-10-06: a box on Admin → Modpack that says when Lock, Build or Sync server has to be pressed, and why.

const mod = (slug: string, enabled = true, version = "latest") => ({ slug, name: slug.toUpperCase(), enabled, version });
const entry = (slug: string, versionId = `v-${slug}`, requiredBy: string[] = []) => ({ slug, name: slug.toUpperCase(), versionId, requiredBy });
const manifest = (mods = [mod("create"), mod("jei")], neoforge = "latest") => ({ version: "0.1.0", neoforge, mods }) as unknown as Manifest;
const lock = (files = [entry("create"), entry("jei")], configs = [{ path: "config/a.toml", sha256: "1" }], resourcepack?: string) =>
  ({ hash: "350c292ab1a29bd8", neoforge: "21.1.253", files, configs, ...(resourcepack ? { resourcepack } : {}) }) as unknown as LockFile;

const SYNCED = new Date("2026-10-06T13:03:53Z");
const BUILT = new Date("2026-10-06T13:03:00Z");
const APP = { version: "3.5.2", sha256: "a".repeat(64) };

/** Everything in step: the lock matches, the build is the lock's, the server runs the build. */
const ok = (over: Partial<PendingFacts> = {}): PendingFacts => ({
  manifest: manifest(),
  lock: lock(),
  configs: [{ path: "config/a.toml", sha256: "1" }],
  resourcepack: undefined,
  builtPack: "0.1.0+350c292a",
  changedSinceBuild: [],
  settingsChanged: false,
  ciApp: APP,
  builtApp: APP,
  repoScript: "2.2.0",
  builtScript: "2.2.0",
  brandingPicked: false,
  synced: { version: "0.1.0+350c292a", at: SYNCED },
  serverBuiltAt: BUILT,
  ...over,
});

describe("the out-of-date box", () => {
  it("says up to date when the lock, the build and the server agree", () => {
    const p = pendingSteps(ok());
    expect(p).toEqual({ steps: [], reasons: [], pack: { repo: "0.1.0+350c292a", built: "0.1.0+350c292a", server: "0.1.0+350c292a" } });
    expect(pendingHeadline(p)).toBe("Up to date: the server runs what is in the repo.");
  });

  it("asks for Lock, Build and Sync when mods.json no longer matches the lock", () => {
    const p = pendingSteps(ok({ manifest: manifest([mod("create"), mod("jei", false), mod("waystones")]) }));
    expect(p.steps).toEqual(["lock", "build", "sync"]);
    expect(p.reasons.map((r) => r.text)).toEqual(["Switched on but not in the lock: WAYSTONES.", "Switched off but still in the lock: JEI."]);
    expect(pendingHeadline(p)).toBe("Out of date: press Lock, then Build, then Sync server.");
  });

  it("does not count a mod that is only in the lock because another needs it", () => {
    expect(lockReasons(ok({ lock: lock([entry("create"), entry("jei"), entry("balm", "v", ["waystones"])]) }))).toEqual([]);
  });

  it("sees a pinned version, NeoForge, settings files and textures that changed after the lock", () => {
    const f = ok({
      manifest: manifest([mod("create", true, "NEWID"), mod("jei")], "21.1.300"),
      configs: [{ path: "config/a.toml", sha256: "2" }, { path: "config/b.toml", sha256: "3" }],
      resourcepack: "r1",
    });
    expect(lockReasons(f)).toEqual([
      "Set to another version than the lock has: CREATE.",
      "NeoForge is set to 21.1.300; the lock has 21.1.253.",
      "Settings files changed: config/a.toml, config/b.toml.",
      "The resource pack's textures changed.",
    ]);
  });

  it("asks for Build and Sync when the lock has a pack the last build did not make", () => {
    const p = pendingSteps(ok({ builtPack: "0.1.0+d7521da9", synced: { version: "0.1.0+d7521da9", at: SYNCED } }));
    expect(p.steps).toEqual(["build", "sync"]);
    expect(p.reasons).toEqual([{ step: "build", text: "The lock has pack 0.1.0+350c292a; the last build made 0.1.0+d7521da9." }]);
  });

  it("asks only for Build when the new app from CI is waiting: the server is not touched", () => {
    const p = pendingSteps(ok({ ciApp: { version: "3.5.3", sha256: "b".repeat(64) } }));
    expect(p.steps).toEqual(["build"]);
    expect(p.reasons[0]!.text).toBe("A new app from CI is waiting: Deepslate Works 3.5.3 (the download is 3.5.2).");
    expect(pendingHeadline(p)).toBe("Out of date: press Build. No sync needed: only the download changed.");
    expect(pendingSteps(ok({ ciApp: { version: "3.5.2", sha256: "c".repeat(64) } })).reasons[0]!.text).toBe("A new app from CI is waiting: Deepslate Works 3.5.2.");
    expect(pendingSteps(ok({ builtApp: null })).steps).toEqual(["build"]);
    expect(pendingSteps(ok({ ciApp: null })).steps).toEqual([]); // nothing from CI on this VPS: nothing to hand out
  });

  it("asks only for Build when the old launcher script changed", () => {
    expect(pendingSteps(ok({ repoScript: "2.3.0" }))).toMatchObject({ steps: ["build"], reasons: [{ text: "The old launcher script is 2.3.0 in the repo; the download has 2.2.0." }] });
  });

  it("names the files that changed in git since the last build, and asks for Sync only when the server reads them", () => {
    const server = pendingSteps(ok({ changedSinceBuild: ["modpack/datapacks/deepslate/data/x.json", "docs/11-status.md", "apps/web/src/a.ts"] }));
    expect(server.steps).toEqual(["build", "sync"]);
    expect(server.reasons).toEqual([{ step: "build", text: "Changed since the last build: modpack/datapacks/deepslate/data/x.json." }]);
    expect(pendingSteps(ok({ changedSinceBuild: ["installer/README.txt"] })).steps).toEqual(["build"]);
    expect(pendingSteps(ok({ changedSinceBuild: ["docs/07-installer.md", "modpack/mods.json"] })).steps).toEqual([]); // not read by Build (mods.json: settingsChanged)
    expect(pendingSteps(ok({ changedSinceBuild: null })).steps).toEqual([]); // not known: nothing said
    const many = pendingSteps(ok({ changedSinceBuild: ["1", "2", "3", "4", "5", "6", "7"].map((n) => `modpack/server/f${n}`) }));
    expect(many.reasons[0]!.text).toBe("Changed since the last build: modpack/server/f1, modpack/server/f2, modpack/server/f3, modpack/server/f4, modpack/server/f5 and 2 more.");
  });

  it("asks for Build and Sync when mods.json's settings or the logo changed", () => {
    expect(pendingSteps(ok({ settingsChanged: true })).steps).toEqual(["build", "sync"]);
    expect(pendingSteps(ok({ brandingPicked: true })).steps).toEqual(["build", "sync"]);
  });

  it("asks for Sync when the server runs another pack, was never synced, or the build is newer than the sync", () => {
    expect(pendingSteps(ok({ synced: { version: "0.1.0+d7521da9", at: SYNCED } }))).toMatchObject({ steps: ["sync"], reasons: [{ step: "sync", text: "The server runs pack 0.1.0+d7521da9; the build is 0.1.0+350c292a." }] });
    expect(pendingSteps(ok({ synced: null })).reasons).toEqual([{ step: "sync", text: "The server has not been synced from the site yet." }]);
    expect(pendingSteps(ok({ serverBuiltAt: new Date(SYNCED.getTime() + 60_000) })).reasons).toEqual([{ step: "sync", text: "Built again after the last sync." }]);
    expect(pendingHeadline({ steps: ["sync"] })).toBe("Out of date: press Sync server.");
  });

  it("docs/37: asks for Build and Sync when a build was uploaded, replaced or removed since the last build", () => {
    const at = new Date("2026-10-06T12:00:00Z");
    const later = new Date(at.getTime() + 60_000);
    expect(uploadsSinceBuild({ names: ["gate", "mill"], at }, [{ name: "gate", at }, { name: "mill", at }])).toEqual([]);
    expect(uploadsSinceBuild({ names: ["gate", "mill"], at }, [{ name: "gate", at: later }, { name: "tower", at }])).toEqual(["gate", "mill", "tower"]);
    expect(uploadsSinceBuild(null, [{ name: "gate", at }])).toEqual(["gate"]);
    expect(uploadsSinceBuild(null, [])).toEqual([]);
    const p = pendingSteps(ok({ uploadsChanged: ["tower"] }));
    expect(p).toMatchObject({ steps: ["build", "sync"], reasons: [{ step: "build", text: "Builds uploaded or removed since the last build: tower." }] });
  });

  it("asks for everything when nothing has been locked or built", () => {
    const p = pendingSteps(ok({ lock: null, builtPack: null, synced: null }));
    expect(p.steps).toEqual(["lock", "build", "sync"]);
    expect(p.reasons).toEqual([{ step: "lock", text: "There is no lock yet." }]);
  });
});
