import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCommand, runBuild, type BuildEvent } from "../src/modpack/build.js";
import { buildServer } from "../src/server.js";
import { loadEnv } from "../src/env.js";

const TOKEN = "t".repeat(40);
let repo: string;
let env: ReturnType<typeof loadEnv>;

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "repo-"));
  env = loadEnv({
    API_SERVICE_TOKEN: TOKEN,
    AMP_MOCK: "1",
    AMP_PASSWORD: "amp-secret",
    DATABASE_URL: "postgresql://x:y@localhost:5432/z",
    REPO_DIR: repo,
    MODRINTH_USER_AGENT: "deepslate-works/test",
  });
});
afterAll(() => rm(repo, { recursive: true, force: true }));

/** A stand-in for the CLI: any node one-liner, run with the real spawn and line streaming. */
function fake(script: string, dist = repo) {
  return { cmd: process.execPath, args: ["-e", script], cwd: repo, env: { PATH: process.env.PATH ?? "", DIST_DIR: dist } };
}
async function collect(gen: AsyncGenerator<BuildEvent>) {
  const out: BuildEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("modpack build runner", () => {
  it("caps the heap and passes the CLI no secrets", () => {
    const c = buildCommand(env, "server");
    expect(c.args).toEqual(["--max-old-space-size=256", "--import", "tsx", "src/cli.ts", "build", "server"]);
    expect(c.cwd).toBe("/app/packages/modpack");
    expect(c.env.DIST_DIR).toBe(`${repo}/dist`);
    expect(c.env.MODRINTH_USER_AGENT).toBe("deepslate-works/test");
    expect(Object.keys(c.env).sort()).toEqual(["AUTH_URL", "DIST_DIR", "HOME", "MODPACK_DIR", "MODRINTH_USER_AGENT", "NODE_ENV", "PATH", "REPO_DIR"]);
    expect(JSON.stringify(c.env)).not.toMatch(/amp-secret|postgresql|tttt/);
  });

  it("passes the server's name from Admin > Branding to the CLI", () => {
    expect(buildCommand(env, "installer", "The Mine").env.PACK_NAME).toBe("The Mine");
    expect("PACK_NAME" in buildCommand(env, "installer").env).toBe(false);
  });

  it("yields stdout and stderr lines, then done", async () => {
    const events = await collect(runBuild(env, "all", { command: fake('console.log("one\\ntwo"); console.error("warn"); console.log("three")') }));
    const lines = events.flatMap((e) => ("line" in e ? [e.line] : []));
    expect(lines.filter((l) => l !== "warn")).toEqual(["one", "two", "three"]);
    expect(lines).toContain("warn");
    expect(events.at(-1)).toEqual({ done: true, ok: true, code: 0 });
  });

  it("delivers lines while the build is still running", async () => {
    const gen = runBuild(env, "all", { command: fake('console.log("first"); setTimeout(() => console.log("last"), 1500)') });
    const started = Date.now();
    const first = await gen.next();
    expect(first.value).toEqual({ line: "first" });
    expect(Date.now() - started).toBeLessThan(1200);
    const rest = await collect(gen);
    expect(rest).toEqual([{ line: "last" }, { done: true, ok: true, code: 0 }]);
  });

  it("reports a failing build", async () => {
    const events = await collect(runBuild(env, "all", { command: fake('console.error("ERROR boom"); process.exit(3)') }));
    expect(events).toEqual([{ line: "ERROR boom" }, { line: "ERROR modpack build exited with code 3" }, { done: true, ok: false, code: 3 }]);
  });

  it("stops a build that runs past the time limit", async () => {
    const events = await collect(runBuild(env, "all", { timeoutMs: 300, command: fake('console.log("start"); setInterval(() => {}, 1000)') }));
    expect(events).toEqual([{ line: "start" }, { line: "ERROR build timed out and was stopped" }, { done: true, ok: false, code: 137 }]);
  });

  it("stops the child when the reader goes away", async () => {
    const gen = runBuild(env, "all", { command: fake('console.log(process.pid); setInterval(() => {}, 1000)') });
    const first = await gen.next();
    const pid = Number((first.value as { line: string }).line);
    await gen.return(undefined);
    await new Promise((r) => setTimeout(r, 300));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("says so when dist is not writable", async () => {
    const events = await collect(runBuild(env, "all", { command: fake("", path.join(repo, "missing")) }));
    expect(events.at(-1)).toEqual({ done: true, ok: false, code: 1 });
    expect((events[0] as { line: string }).line).toMatch(/^ERROR .*not writable/);
  });
});

describe("POST /modpack/build", () => {
  const admin = { authorization: `Bearer ${TOKEN}`, "x-user-id": "u1", "x-user-role": "ADMIN" };
  async function* twoLines(): AsyncGenerator<BuildEvent> {
    yield { line: "client.mrpack: 3 mods" };
    yield { done: true, ok: true, code: 0 };
  }

  it("is admin only and validates the target", async () => {
    const app = buildServer(env, undefined, { build: twoLines });
    expect((await app.inject({ method: "POST", url: "/modpack/build" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/modpack/build", headers: { ...admin, "x-user-role": "PLAYER" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/modpack/build", headers: admin, payload: { target: "everything; rm -rf /" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/modpack/build", headers: admin, payload: { target: "client" } })).statusCode).toBe(400); // Windows only: no .mrpack
    await app.close();
  });

  it("streams newline-delimited JSON and frees the lock afterwards", async () => {
    const app = buildServer(env, undefined, { build: twoLines });
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({ method: "POST", url: "/modpack/build", headers: admin, payload: { target: "installer" } });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/x-ndjson/);
      expect(res.body.trim().split("\n").map((l) => JSON.parse(l))).toEqual([{ line: "client.mrpack: 3 mods" }, { done: true, ok: true, code: 0 }]);
    }
    await app.close();
  });

  it("refuses a second build while one is running", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    async function* slow(): AsyncGenerator<BuildEvent> {
      yield { line: "working" };
      await gate;
      yield { done: true, ok: true, code: 0 };
    }
    const app = buildServer(env, undefined, { build: slow });
    const first = app.inject({ method: "POST", url: "/modpack/build", headers: admin });
    await new Promise((r) => setTimeout(r, 100));
    const second = await app.inject({ method: "POST", url: "/modpack/build", headers: admin });
    expect(second.statusCode).toBe(409);
    const sync = await app.inject({ method: "POST", url: "/modpack/sync", headers: admin, payload: { dryRun: true } });
    expect(sync.statusCode).toBe(409);
    release();
    expect((await first).statusCode).toBe(200);
    await app.close();
  });
});
