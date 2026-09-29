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

export function buildServer(env: Env, amp?: Amp) {
  const app = Fastify({ logger: { level: "info" }, trustProxy: false });
  const ampClient: Amp = amp ?? (env.AMP_MOCK === "1"
    ? new MockAmp()
    : new AmpClient({ url: env.AMP_URL, username: env.AMP_USERNAME, password: env.AMP_PASSWORD, instanceId: env.AMP_INSTANCE_ID }));

  app.addHook("onRequest", serviceAuth(env.API_SERVICE_TOKEN));
  app.get("/health", async () => health(env, ampClient));
  statusRoutes(app, ampClient);
  modpackRoutes(app, env, ampClient);

  // Console tail + the wait room run for the life of the process (docs/14).
  const tail = new ConsoleTail(ampClient, (o, m) => app.log.info(o, m));
  const limbo = new Limbo(env, ampClient, tail, (o, m) => app.log.info(o, m));
  playerRoutes(app, ampClient, tail, limbo);
  app.addHook("onReady", async () => {
    if (env.AMP_MOCK === "1") return;
    tail.start();
    limbo.start();
  });
  app.addHook("onClose", async () => {
    tail.stop();
    limbo.stop();
  });
  return app;
}
