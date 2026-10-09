import Fastify from "fastify";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { serviceAuth } from "../src/auth.js";
import { TEST_APP_PATHS, testAppRoutes } from "../src/test-mode/app-routes.js";
import type { ServerState } from "../src/shared/server-state.js";

// docs/45: what the test server's api tells the live web for the launcher's Test section, behind a token of its own.

const SERVICE = "s".repeat(64);
const APP = "a".repeat(64);

async function setup(state: ServerState = "asleep") {
  const repo = await mkdtemp(path.join(tmpdir(), "test-app-"));
  await mkdir(path.join(repo, "modpack"), { recursive: true });
  await mkdir(path.join(repo, "dist"), { recursive: true });
  await writeFile(path.join(repo, "modpack", "mods.json"), JSON.stringify({ name: "Deepslate Works", version: "0.1.0" }));
  await writeFile(path.join(repo, "modpack", "mods.lock.json"), JSON.stringify({ hash: "d44eb2ba".padEnd(64, "0"), files: [] }));
  await writeFile(path.join(repo, "dist", "config.zip"), Buffer.from([80, 75, 3, 4]));
  const woke: Array<{ id: string; name: string; via: string }> = [];
  const app = Fastify();
  app.addHook("onRequest", serviceAuth(SERVICE, Object.fromEntries(TEST_APP_PATHS.map((p) => [p, APP]))));
  app.get("/players", async () => ({ any: "service route" }));
  testAppRoutes(app, {
    repoDir: repo,
    server: () => ({ state, players: [] }),
    address: "lab.dsw.test",
    pack: async () => ({ site: "0.1.0+d44eb2ba", server: "0.1.0+d44eb2ba" }),
    wake: { start: async (id: string, name: string, via?: string) => { woke.push({ id, name, via: via ?? "" }); }, view: () => ({ phase: "idle" }) as never },
    memberByDiscord: async (d) => (d === "123456789012345678" ? { id: "t1", displayName: "Alex" } : null),
  });
  return { app, woke };
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe("the Test section's routes on the test server (docs/45)", () => {
  it("answer only their own token: not the service token, not nothing", async () => {
    const { app } = await setup();
    for (const url of ["/test/app/pack", "/test/app/state", "/test/app/config.zip"]) {
      expect((await app.inject({ url, headers: bearer(SERVICE) })).statusCode).toBe(401);
      expect((await app.inject({ url })).statusCode).toBe(401);
      expect((await app.inject({ url, headers: bearer(APP) })).statusCode).toBe(200);
    }
  });
  it("their token opens nothing else", async () => {
    const { app } = await setup();
    expect((await app.inject({ url: "/players", headers: bearer(APP) })).statusCode).toBe(401);
    expect((await app.inject({ url: "/players", headers: bearer(SERVICE) })).statusCode).toBe(200);
  });
  it("serve the test checkout's pack and settings bundle as they are", async () => {
    const { app } = await setup();
    const pack = (await app.inject({ url: "/test/app/pack", headers: bearer(APP) })).json() as { mods: { version: string }; lock: { hash: string } };
    expect(pack.mods.version).toBe("0.1.0");
    expect(pack.lock.hash.startsWith("d44eb2ba")).toBe(true);
    const zip = await app.inject({ url: "/test/app/config.zip", headers: bearer(APP) });
    expect(zip.headers["content-type"]).toBe("application/zip");
    expect([...zip.rawPayload]).toEqual([80, 75, 3, 4]);
  });
  it("wake an asleep test server, naming the live admin in the event log", async () => {
    const { app, woke } = await setup("asleep");
    const r = await app.inject({ method: "POST", url: "/test/app/wake", headers: bearer(APP), payload: { discordId: "123456789012345678", name: "Alex" } });
    expect(r.statusCode).toBe(202);
    expect(woke).toEqual([{ id: "t1", name: "Alex (live admin, through the app's Test section)", via: "app" }]);
  });
  it("do not start a switched-off test server, and say so", async () => {
    const { app, woke } = await setup("off");
    const r = await app.inject({ method: "POST", url: "/test/app/wake", headers: bearer(APP), payload: { name: "Alex" } });
    expect(r.statusCode).toBe(409);
    expect(woke).toEqual([]);
  });
});
