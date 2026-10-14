import { describe, expect, it } from "vitest";
import { checkLines, missingOnServer, verifyServer, type Capture } from "../src/modpack/verify.js";

// Alex, 2026-10-14: Sync says it restarts the server, then checks the server came back with every mod the pack gives it.

const lock = {
  files: [
    { slug: "create", name: "Create", filename: "create-6.0.10.jar", side: "both" },
    { slug: "spark", name: "spark", filename: "spark-1.10.jar", side: "server" },
    { slug: "sodium", name: "Sodium", filename: "sodium-0.8.jar", side: "client" },
    { slug: "wilder-flowers", name: "Wilder Flowers", filename: "wilderflowers-1.1.0.jar", side: "both" },
  ],
};
const loaded = (...names: string[]) => names.map((filename) => ({ filename, nested: false }));
const capture = (at: number, files = loaded("create-6.0.10.jar", "spark-1.10.jar", "wilderflowers-1.1.0.jar")): Capture => ({ at: new Date(at), files, problems: [], ...missingOnServer(files, lock) });

describe("the pack's server mods against what the server loaded", () => {
  it("expects every file that is not for PCs only, and names the ones the server did not load", () => {
    expect(missingOnServer(loaded("create-6.0.10.jar", "spark-1.10.jar", "wilderflowers-1.1.0.jar"), lock)).toEqual({ expected: 3, missing: [] });
    expect(missingOnServer(loaded("create-6.0.10.jar"), lock)).toEqual({ expected: 3, missing: [{ filename: "spark-1.10.jar", slug: "spark" }, { filename: "wilderflowers-1.1.0.jar", slug: "wilder-flowers" }] });
  });
  it("says so in the Sync log: all there, or an ERROR line and one line per missing file", () => {
    expect(checkLines(capture(0), "its start")).toEqual(["checked its start: all 3 mods the pack gives the server are loaded"]);
    expect(checkLines(capture(0, loaded("create-6.0.10.jar", "spark-1.10.jar")), "its start")).toEqual(["ERROR its start: 1 of the pack's 3 server mods are not loaded", "  missing wilderflowers-1.1.0.jar (wilder-flowers)"]);
  });
});

describe("the check after a Sync", () => {
  const clock = () => {
    let t = 1_000_000;
    return { now: () => t, sleep: async (ms: number) => void (t += ms) };
  };
  it("after a restart, waits for a start after it and checks that one, not the start before", async () => {
    const c = clock();
    const since = new Date(1_000_000);
    let calls = 0;
    const latest = () => (++calls < 20 ? capture(900_000) : capture(1_045_000));
    const r = await verifyServer({ capture: async () => null, latest, ...c }, since);
    expect(r).toEqual({ ok: true, lines: ["the server is back up (45 s after the restart)", "checked its start: all 3 mods the pack gives the server are loaded"] });
  });
  it("gives up with an ERROR when the server does not come back", async () => {
    const r = await verifyServer({ capture: async () => null, latest: () => null, timeoutMs: 60_000, ...clock() }, new Date(1_000_000));
    expect(r.ok).toBe(false);
    expect(r.lines).toEqual(["ERROR the server has not come back up within 1 minute of the restart: look at Admin → Server"]);
  });
  it("with no restart, checks the server's last start from its log", async () => {
    const r = await verifyServer({ capture: async () => capture(5, loaded("create-6.0.10.jar")), latest: () => null });
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toBe("ERROR the server's last start: 2 of the pack's 3 server mods are not loaded");
  });
  it("says it could not check when the log cannot be read", async () => {
    expect(await verifyServer({ capture: async () => null, latest: () => null })).toEqual({ ok: false, lines: ["WARN could not read the server's log, so its mods were not checked"] });
  });
});
