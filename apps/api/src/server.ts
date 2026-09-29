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
import { fileRoutes } from "./routes/files.js";
import { StatusPoller } from "./status/poller.js";
import { prismaSnapshotStore } from "./status/store.js";
import { RestartSchedule } from "./status/restart.js";
import { Recorder } from "./events/recorder.js";
import { prismaRecorderStore } from "./events/store.js";
import { countryOf } from "./events/geo.js";
import { runRetentionIfDue } from "./events/retention.js";
import { getSection } from "./settings.js";

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
  fileRoutes(app, ampClient);

  // docs/16: sessions and the event log, fed by the console tail and the status poller.
  const recorder = new Recorder({
    store: prismaRecorderStore,
    privacy: () => getSection("privacy"),
    country: (ip) => countryOf(ip, env.GEOIP_DB),
    uuidOf: (name) => tail.uuidByName.get(name),
    log,
  });
  let housekeeping: NodeJS.Timeout | null = null;

  app.addHook("onReady", async () => {
    if (env.AMP_MOCK === "1") return;
    await recorder.init().catch((err) => log({ err: String(err) }, "could not load open sessions"));
    tail.on(recorder.onConsole);
    poller.onStatus(recorder.onStatus);
    tail.start();
    poller.start();
    limbo.start();
    const keepHouse = () => void runRetentionIfDue(log).catch((err) => log({ err: String(err) }, "retention failed"));
    housekeeping = setInterval(keepHouse, 30 * 60_000);
    setTimeout(keepHouse, 60_000).unref();
  });
  app.addHook("onClose", async () => {
    tail.stop();
    poller.stop();
    limbo.stop();
    restarts.stop();
    if (housekeeping) clearInterval(housekeeping);
  });
  return app;
}
