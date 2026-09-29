import Fastify from "fastify";
import { AmpClient, MockAmp, type Amp } from "./amp/client.js";
import { serviceAuth } from "./auth.js";
import type { Env } from "./env.js";
import { health } from "./health.js";
import { statusRoutes } from "./routes/status.js";
import { modpackRoutes } from "./routes/modpack.js";
import { playerRoutes } from "./routes/players.js";
import { ConsoleTail } from "./amp/console.js";
import { Limbo } from "./players/limbo.js";
import type { runBuild } from "./modpack/build.js";
import { serverRoutes } from "./routes/server.js";
import { StatusPoller } from "./status/poller.js";
import { prismaSnapshotStore } from "./status/store.js";
import { RestartSchedule } from "./status/restart.js";
import { db } from "./db.js";

export function buildServer(env: Env, amp?: Amp, deps: { build?: typeof runBuild } = {}) {
  const app = Fastify({ logger: { level: "info" }, trustProxy: false });
  const ampClient: Amp = amp ?? (env.AMP_MOCK === "1"
    ? new MockAmp()
    : new AmpClient({ url: env.AMP_URL, username: env.AMP_USERNAME, password: env.AMP_PASSWORD, instanceId: env.AMP_INSTANCE_ID }));

  app.addHook("onRequest", serviceAuth(env.API_SERVICE_TOKEN));
  app.get("/health", async () => health(env, ampClient));
  modpackRoutes(app, env, ampClient, deps.build);

  // Console tail, status poller and the wait room run for the life of the process (docs/05, docs/14).
  const log = (o: unknown, m: string) => app.log.info(o, m);
  const tail = new ConsoleTail(ampClient, log);
  const poller = new StatusPoller(ampClient, tail, env.AMP_MOCK === "1" ? null : prismaSnapshotStore, log);
  const limbo = new Limbo(env, ampClient, tail, log);
  const restarts = new RestartSchedule(ampClient, () => limbo.actionCtx, log);
  statusRoutes(app, ampClient, poller, tail);
  playerRoutes(app, ampClient, tail, limbo);
  serverRoutes(app, ampClient, tail, restarts);

  // "Last seen" on the Players page: stamped when someone joins and again when they leave.
  tail.on((e) => {
    if (e.type !== "join" && e.type !== "leave") return;
    const uuid = tail.uuidByName.get(e.name);
    if (!uuid) return;
    void db.user.updateMany({ where: { mcUuid: uuid }, data: { lastSeenAt: new Date() } }).catch((err) => log({ err: String(err) }, "lastSeenAt update failed"));
  });

  app.addHook("onReady", async () => {
    if (env.AMP_MOCK === "1") return;
    tail.start();
    poller.start();
    limbo.start();
  });
  app.addHook("onClose", async () => {
    tail.stop();
    poller.stop();
    limbo.stop();
    restarts.stop();
  });
  return app;
}
