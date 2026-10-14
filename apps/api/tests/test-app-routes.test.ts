import Fastify from "fastify";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { serviceAuth } from "../src/auth.js";
import { TEST_APP_PATHS, testAppRoutes } from "../src/test-mode/app-routes.js";
import type { ServerState } from "../src/shared/server-state.js";
import { Testers } from "../src/test-mode/testers.js";
import { testersHash } from "../src/shared/testers.js";

/** docs/57: a tester list with nothing behind it but what it was told. */
const noTesters = () => new Testers({ load: async () => null, save: async () => {}, isAdmin: async () => false, admit: async () => {}, hold: async () => {}, server: () => ({ up: false, players: [] }), run: async () => true, log: () => {} });

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
    testers: noTesters(),
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
  it("wake it for a tester too (docs/57 T2), naming them as a live tester", async () => {
    const { app, woke } = await setup("asleep");
    const r = await app.inject({ method: "POST", url: "/test/app/wake", headers: bearer(APP), payload: { discordId: null, name: "KaneFinch", as: "tester" } });
    expect(r.statusCode).toBe(202);
    expect(woke).toEqual([{ id: "", name: "KaneFinch (live tester, through the app's Test section)", via: "app" }]);
  });
  it("do not start a switched-off test server, and say so", async () => {
    const { app, woke } = await setup("off");
    const r = await app.inject({ method: "POST", url: "/test/app/wake", headers: bearer(APP), payload: { name: "Alex" } });
    expect(r.statusCode).toBe(409);
    expect(woke).toEqual([]);
  });
});

describe("the test wake tells the truth (3.6.1, item 7)", () => {
  async function withState(states: ServerState[]) {
    let at = 0;
    let asked = 0;
    const woke: string[] = [];
    const app = Fastify();
    app.addHook("onRequest", serviceAuth(SERVICE, Object.fromEntries(TEST_APP_PATHS.map((p) => [p, APP]))));
    testAppRoutes(app, {
      repoDir: tmpdir(),
      server: () => ({ state: states[Math.min(at, states.length - 1)], players: [] }),
      address: "lab.dsw.test",
      pack: async () => ({ site: null, server: null }),
      wake: { start: async (_id: string, name: string) => { woke.push(name); }, view: () => ({ phase: woke.length ? "waking" : "idle" }) as never },
      refresh: async () => { asked++; at++; },
      memberByDiscord: async () => null,
      testers: noTesters(),
    });
    return { app, woke, asked: () => asked };
  }

  it("asks AMP once more before it answers unreachable: a poller between two reads is not an answer", async () => {
    const t = await withState(["unreachable", "asleep"]);
    const r = await t.app.inject({ method: "POST", url: "/test/app/wake", headers: bearer(APP), payload: { name: "Alex" } });
    expect(t.asked()).toBe(1);
    expect(r.statusCode).toBe(202);
    expect(t.woke).toHaveLength(1);
  });

  it("says unreachable only when AMP still does not answer", async () => {
    const t = await withState(["unreachable", "unreachable"]);
    const r = await t.app.inject({ method: "POST", url: "/test/app/wake", headers: bearer(APP), payload: { name: "Alex" } });
    expect(t.asked()).toBe(1);
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe("unreachable");
  });

  it("online, waking and switched off each answer as they are, without asking AMP again", async () => {
    for (const [state, code] of [["online", 200], ["waking", 200], ["off", 409], ["starting", 409]] as const) {
      const t = await withState([state]);
      const r = await t.app.inject({ method: "POST", url: "/test/app/wake", headers: bearer(APP), payload: { name: "Alex" } });
      expect(r.statusCode, state).toBe(code);
      expect(t.asked(), state).toBe(0);
    }
  });

  it("the wake the app watches is there, by GET, to the app's token only", async () => {
    const t = await withState(["asleep"]);
    await t.app.inject({ method: "POST", url: "/test/app/wake", headers: bearer(APP), payload: { name: "Alex" } });
    const r = await t.app.inject({ url: "/test/app/wake", headers: bearer(APP) });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { wake: { phase: string } }).wake.phase).toBe("waking");
    expect((await t.app.inject({ url: "/test/app/wake", headers: bearer(SERVICE) })).statusCode).toBe(401);
  });
});

describe("who the testers are (docs/57): POST /test/app/tester", () => {
  const KANE = { uuid: "0f2a7c3e9d1b4c6a8e5f7a9b1c3d5e7f", name: "KaneFinch" };
  it("is the token's fifth path, and only its", async () => {
    const { app } = await setup();
    expect(TEST_APP_PATHS).toHaveLength(6);
    expect(TEST_APP_PATHS).toContain("/test/app/tester");
    expect((await app.inject({ method: "POST", url: "/test/app/tester", headers: bearer(SERVICE), payload: { ...KANE, on: true } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/test/app/tester", payload: { ...KANE, on: true } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/test/app/tester", headers: bearer(APP), payload: { ...KANE, on: true } })).statusCode).toBe(200);
  });
  it("refuses anything that is not a tester or a list of them", async () => {
    const { app } = await setup();
    for (const payload of [{}, { uuid: KANE.uuid, name: "not a name!", on: true }, { uuid: "x", name: "KaneFinch", on: true }, { ...KANE }, { testers: [{ uuid: KANE.uuid }] }]) {
      expect((await app.inject({ method: "POST", url: "/test/app/tester", headers: bearer(APP), payload })).statusCode).toBe(400);
    }
  });
  it("the state's fingerprint is null until the whole list has come since the start, then the list's", async () => {
    const { app } = await setup();
    const state = async () => ((await app.inject({ url: "/test/app/state", headers: bearer(APP) })).json() as { testers: string | null }).testers;
    expect(await state()).toBeNull();
    await app.inject({ method: "POST", url: "/test/app/tester", headers: bearer(APP), payload: { ...KANE, on: true } });
    expect(await state()).toBeNull(); // one change is not the whole list
    const r = await app.inject({ method: "POST", url: "/test/app/tester", headers: bearer(APP), payload: { testers: [KANE] } });
    expect((r.json() as { testers: string }).testers).toBe(testersHash([KANE]));
    expect(await state()).toBe(testersHash([KANE]));
  });
});

describe("a private jar of the test pack (docs/58): GET /test/app/mod?file=", () => {
  const NAME = "bossmod-1.21.1-1.8.2-dsw.1.jar";
  const JAR = Buffer.from("PK a patched jar");
  const sha512 = (b: Buffer) => createHash("sha512").update(b).digest("hex");
  async function repoWith(files: unknown[], jar: Buffer | null, ship: string[] = []) {
    const repo = await mkdtemp(path.join(tmpdir(), "test-app-mod-"));
    await mkdir(path.join(repo, "modpack", "seasons"), { recursive: true });
    await mkdir(path.join(repo, "data", "private-jars"), { recursive: true });
    await writeFile(path.join(repo, "modpack", "mods.lock.json"), JSON.stringify({ neoforge: "21.1.252", hash: "0".repeat(64), configs: [], files }));
    await writeFile(path.join(repo, "modpack", "seasons", "index.json"), JSON.stringify({ current: "s1", ship }));
    if (jar) await writeFile(path.join(repo, "data", "private-jars", NAME), jar);
    const app = Fastify();
    app.addHook("onRequest", serviceAuth(SERVICE, Object.fromEntries(TEST_APP_PATHS.map((p) => [p, APP]))));
    testAppRoutes(app, { repoDir: repo, server: () => ({ state: "asleep", players: [] }), address: null, pack: async () => ({ site: null, server: null }), wake: { start: async () => {}, view: () => ({ phase: "idle" }) as never }, memberByDiscord: async () => null, testers: noTesters() });
    return app;
  }
  const entry = (extra: Record<string, unknown> = {}) => ({ slug: "boss-mod", versionId: "private-x", filename: NAME, url: `/downloads/mods/${NAME}`, sha512: sha512(JAR), ...extra });
  const get = (app: Awaited<ReturnType<typeof repoWith>>, file: string, token = APP) => app.inject({ url: `/test/app/mod?file=${encodeURIComponent(file)}`, headers: bearer(token) });

  it("is the token's sixth path, and only its", async () => {
    const app = await repoWith([entry()], JAR);
    expect(TEST_APP_PATHS).toContain("/test/app/mod");
    expect((await get(app, NAME, SERVICE)).statusCode).toBe(401);
    expect((await app.inject({ url: `/test/app/mod?file=${NAME}` })).statusCode).toBe(401);
  });
  it("hands out the jar the test lock names, as it is", async () => {
    const app = await repoWith([entry()], JAR);
    const r = await get(app, NAME);
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("application/java-archive");
    expect(r.rawPayload.equals(JAR)).toBe(true);
  });
  it("anything else is a 404: a name not in the lock, a Modrinth file, another season's, a path, a jar that is not the lock's or not there", async () => {
    expect((await get(await repoWith([entry()], JAR), "other.jar")).statusCode).toBe(404);
    expect((await get(await repoWith([entry({ url: `https://cdn.modrinth.com/data/x/versions/y/${NAME}` })], JAR), NAME)).statusCode).toBe(404);
    expect((await get(await repoWith([entry({ season: "s1" })], JAR, []), NAME)).statusCode).toBe(404);
    expect((await get(await repoWith([entry({ season: "s1" })], JAR, ["s1"]), NAME)).statusCode).toBe(200);
    expect((await get(await repoWith([entry()], JAR), `../${NAME}`)).statusCode).toBe(404);
    expect((await get(await repoWith([entry()], Buffer.from("something else")), NAME)).statusCode).toBe(404);
    expect((await get(await repoWith([entry()], null), NAME)).statusCode).toBe(404);
  });
});
