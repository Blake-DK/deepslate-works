import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { wakeDecision, type ServerState } from "../shared/server-state.js";
import type { Wake } from "../status/wake.js";

// The launcher's Test section, version one (planner and Alex, 2026-10-09; docs/45). What the test server's api tells the
// LIVE web, which asks on behalf of an admin's app: the test pack, its settings bundle, the test server's state, and a
// wake. Only on the test server (TEST_MODE), and only to TEST_APP_TOKEN, a token of its own that opens nothing else
// (server.ts gives these four paths that token in serviceAuth). The app never talks to the test stack itself.
//
//   GET  /test/app/pack        mods.json and the lock of the test checkout, as they are
//   GET  /test/app/config.zip  the test Build's settings bundle (dist/config.zip of the test checkout)
//   GET  /test/app/state       the test server's state, players, game address and pack
//   POST /test/app/wake        start the test server when it is asleep; who asked is said in the body

export const TEST_APP_PATHS = ["/test/app/pack", "/test/app/config.zip", "/test/app/state", "/test/app/wake"] as const;

export type TestAppDeps = {
  repoDir: string;
  server: () => { state: ServerState; players: string[] };
  address: string | null;
  pack: () => Promise<{ site: string | null; server: string | null }>;
  wake: Pick<Wake, "start" | "view">;
  /** The test site's own member for a live admin, by Discord id, for the event log; null when there is none. */
  memberByDiscord: (discordId: string) => Promise<{ id: string; displayName: string } | null>;
};

const wakeBody = z.object({ discordId: z.string().regex(/^\d{5,25}$/).nullable().optional(), name: z.string().min(1).max(64) });

export function testAppRoutes(app: FastifyInstance, d: TestAppDeps) {
  app.get("/test/app/pack", async (_req, reply) => {
    try {
      const [mods, lock] = await Promise.all([
        readFile(path.join(d.repoDir, "modpack", "mods.json"), "utf8").then((t) => JSON.parse(t) as unknown),
        readFile(path.join(d.repoDir, "modpack", "mods.lock.json"), "utf8").then((t) => JSON.parse(t) as unknown),
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

  app.get("/test/app/state", async () => {
    const s = d.server();
    return { state: s.state, players: s.players, address: d.address, pack: await d.pack(), wake: d.wake.view() };
  });

  app.post("/test/app/wake", async (req, reply) => {
    const body = wakeBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: { code: "validation", message: "name required" } });
    const state = d.server().state;
    // an admin asks: the door's "open for them" is always true; asleep is the only state a wake starts from
    const decision = wakeDecision({ member: true, openFor: true, state });
    if (decision === "start") {
      const member = body.data.discordId ? await d.memberByDiscord(body.data.discordId).catch(() => null) : null;
      const name = `${member?.displayName ?? body.data.name} (live admin, through the app's Test section)`;
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
}
