import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { wakeDecision, type ServerState } from "../shared/server-state.js";
import type { Wake } from "../status/wake.js";
import { readShippedLock } from "../modpack/ship.js";
import { TESTER_BODY } from "../shared/testers.js";
import type { Testers } from "./testers.js";

// The launcher's Test section, version one (planner and Alex, 2026-10-09; docs/45). What the test server's api tells the
// LIVE web, which asks on behalf of an admin's or a tester's app (docs/57): the test pack, its settings bundle, the test
// server's state, and a wake; and who the testers are. Only on the test server (TEST_MODE), and only to TEST_APP_TOKEN,
// a token of its own that opens nothing else (server.ts gives these five paths that token in serviceAuth). The app
// never talks to the test stack itself.
//
//   GET  /test/app/pack        mods.json and the lock of the test checkout, as they are
//   GET  /test/app/config.zip  the test Build's settings bundle (dist/config.zip of the test checkout)
//   GET  /test/app/state       the test server's state, players, game address and pack
//   POST /test/app/wake        start the test server when it is asleep; who asked is said in the body
//   GET  /test/app/wake        how that wake is going (3.6.1: the app watches it)
//   POST /test/app/tester      docs/57: one Tester switch change { uuid, name, on }, or the whole list { testers }
//   GET  /test/app/mod?file=   docs/58: a private jar the test lock names, from the test checkout's data/private-jars/

export const TEST_APP_PATHS = ["/test/app/pack", "/test/app/config.zip", "/test/app/state", "/test/app/wake", "/test/app/tester", "/test/app/mod"] as const;

// docs/58: the same rule as packages/modpack mod-url.ts (PRIVATE_JAR, privateUrl), which api does not import
const PRIVATE_JAR = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,150}\.jar$/;
const privateUrl = (name: string) => `/downloads/mods/${name}`;
const sums = new Map<string, { key: string; sha512: string }>();

async function sha512Of(file: string, size: number, mtimeMs: number): Promise<string> {
  const key = `${size}:${mtimeMs}`;
  const hit = sums.get(file);
  if (hit?.key === key) return hit.sha512;
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  const sha512 = hash.digest("hex");
  sums.set(file, { key, sha512 });
  return sha512;
}

export type TestAppDeps = {
  repoDir: string;
  server: () => { state: ServerState; players: string[] };
  address: string | null;
  pack: () => Promise<{ site: string | null; server: string | null }>;
  wake: Pick<Wake, "start" | "view">;
  /** Ask AMP once now (the status poller's poll); the wake does before it answers "unreachable" (3.6.1). */
  refresh?: () => Promise<void>;
  /** The test site's own member for a live admin, by Discord id, for the event log; null when there is none. */
  memberByDiscord: (discordId: string) => Promise<{ id: string; displayName: string } | null>;
  /** docs/57: the testers the live site has sent. */
  testers: Pick<Testers, "one" | "all" | "hash">;
  /** docs/58: where the private jars are; the checkout's data/private-jars/ unless said. */
  privateJarsDir?: string;
};

// `as` (docs/57): whether the live site let them in as an admin or as a tester; older live sites leave it out
const wakeBody = z.object({ discordId: z.string().regex(/^\d{5,25}$/).nullable().optional(), name: z.string().min(1).max(64), as: z.enum(["admin", "tester"]).default("admin") });

export function testAppRoutes(app: FastifyInstance, d: TestAppDeps) {
  app.get("/test/app/pack", async (_req, reply) => {
    try {
      const [mods, lock] = await Promise.all([
        readFile(path.join(d.repoDir, "modpack", "mods.json"), "utf8").then((t) => JSON.parse(t) as unknown),
        // docs/44: the test server's pack, the seasons it ships and no others, so the app installs what it runs
        readShippedLock(d.repoDir),
      ]);
      return reply.header("cache-control", "no-store").send({ mods, lock });
    } catch {
      return reply.code(503).send({ error: { code: "no_pack", message: "The test checkout has no pack to read" } });
    }
  });

  app.get("/test/app/config.zip", async (_req, reply) => {
    const file = path.join(d.repoDir, "dist", "config.zip");
    const s = await stat(file).catch(() => null);
    if (!s?.isFile()) return reply.code(404).send({ error: { code: "no_config", message: "Build the test pack first" } });
    return reply.header("content-type", "application/zip").header("content-length", String(s.size)).header("cache-control", "no-store").send(createReadStream(file));
  });

  // docs/58: only a jar the test server's own pack names as private, and only the very file it names
  app.get("/test/app/mod", async (req, reply) => {
    const name = (req.query as { file?: unknown } | undefined)?.file;
    const missing = () => reply.code(404).send({ error: { code: "not_found", message: "No such private jar in the test pack" } });
    if (typeof name !== "string" || !PRIVATE_JAR.test(name)) return missing();
    const lock = await readShippedLock(d.repoDir).catch(() => null);
    const entry = lock?.files.find((f) => f.filename === name && f.url === privateUrl(name));
    if (!entry) return missing();
    // the path is the lock's own file name, and stays inside the folder of private jars whatever that name is
    const dir = path.resolve(d.privateJarsDir ?? path.join(d.repoDir, "data", "private-jars"));
    const file = path.resolve(dir, path.basename(String(entry.filename)));
    if (!file.startsWith(dir + path.sep)) return missing();
    const s = await stat(file).catch(() => null);
    if (!s?.isFile()) {
      req.log.warn({ file: name }, "docs/58: a private jar the test lock names is not in data/private-jars/");
      return missing();
    }
    if ((await sha512Of(file, s.size, s.mtimeMs)) !== entry.sha512) {
      req.log.warn({ file: name }, "docs/58: the private jar in data/private-jars/ is not the one the test lock names");
      return missing();
    }
    return reply.header("content-type", "application/java-archive").header("content-length", String(s.size)).header("cache-control", "no-store").send(createReadStream(file));
  });

  app.get("/test/app/state", async () => {
    const s = d.server();
    // `testers` (docs/57): the fingerprint of the tester list held here, null until the live site has sent it whole
    return { state: s.state, players: s.players, address: d.address, pack: await d.pack(), wake: d.wake.view(), testers: d.testers.hash() };
  });

  // 3.6.1 (item 7): what the app watches after a wake, every 5 s until the server is up (its "wake.phase")
  app.get("/test/app/wake", async () => ({ server: d.server().state, wake: d.wake.view() }));

  app.post("/test/app/wake", async (req, reply) => {
    const body = wakeBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: { code: "validation", message: "name required" } });
    let state = d.server().state;
    // 3.6.1 (item 7): no fresh word from AMP is not an answer yet. The poller may only be between two reads (its
    // session was being replaced, or the server is coming back): AMP is asked once more before "unreachable" is said
    if (state === "unreachable" && d.refresh) {
      await d.refresh().catch(() => undefined);
      state = d.server().state;
    }
    // an admin or a tester asks (docs/57 T2): the door's "open for them" is always true; asleep is the only state a wake
    // starts from
    const decision = wakeDecision({ member: true, openFor: true, state });
    if (decision === "start") {
      const member = body.data.discordId ? await d.memberByDiscord(body.data.discordId).catch(() => null) : null;
      const name = `${member?.displayName ?? body.data.name} (live ${body.data.as}, through the app's Test section)`;
      try {
        await d.wake.start(member?.id ?? "", name, "app");
      } catch (e) {
        return reply.code(502).send({ error: { code: "amp_error", message: e instanceof Error ? e.message : String(e) }, wake: d.wake.view() });
      }
      return reply.code(202).send({ result: "started", server: "waking", wake: d.wake.view() });
    }
    if (decision === "already" || decision === "awake") return { result: decision, server: state, wake: d.wake.view() };
    return reply.code(409).send({ error: { code: decision, message: decision === "off" ? "The test server is switched off. Start it from the test site." : "The test server can't be woken right now." }, server: state, wake: d.wake.view() });
  });

  // docs/57: the live site's Tester switch. One change, or the whole list (at every start of this api, and whenever the
  // live site sees this list's fingerprint is not its own). The answer is the fingerprint after it.
  app.post("/test/app/tester", async (req, reply) => {
    const body = TESTER_BODY.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: { code: "validation", message: "a tester { uuid, name, on } or { testers }" } });
    if ("testers" in body.data) await d.testers.all(body.data.testers);
    else await d.testers.one(body.data);
    return { testers: d.testers.hash() };
  });
}
