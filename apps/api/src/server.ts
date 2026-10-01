import Fastify from "fastify";
import { AmpClient, MockAmp, type Amp } from "./amp/client.js";
import { serviceAuth } from "./auth.js";
import type { Env } from "./env.js";
import { health, tcpReachable } from "./health.js";
import { audit } from "./audit.js";
import { Wake } from "./status/wake.js";
import { ServerView, reasonFor } from "./status/view.js";
import { wakeRoutes } from "./routes/wake.js";
import { Catalogue, InventoryEditor } from "./players/editor.js";
import { statusRoutes } from "./routes/status.js";
import { modpackRoutes } from "./routes/modpack.js";
import { playerRoutes } from "./routes/players.js";
import { ConsoleTail } from "./amp/console.js";
import { Limbo } from "./players/limbo.js";
import type { runBuild } from "./modpack/build.js";
import { serverRoutes } from "./routes/server.js";
import { fileRoutes } from "./routes/files.js";
import { StatusPoller } from "./status/poller.js";
import { PingWatch } from "./status/ping.js";
import { PLAN_KEY, Pregen, PregenWatch, type PregenPlan } from "./status/pregen.js";
import { pregenRoutes } from "./routes/pregen.js";
import { consoleRoutes } from "./routes/console.js";
import { inventoryRoutes } from "./routes/inventory.js";
import { OnlineWatch } from "./status/online.js";
import { db } from "./db.js";
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
  modpackRoutes(app, env, ampClient, deps.build, () => pregen.quiesce());

  // Console tail, status poller and the wait room run for the life of the process (docs/05, docs/14).
  const log = (o: unknown, m: string) => app.log.info(o, m);
  const tail = new ConsoleTail(ampClient, log);
  const limbo = new Limbo(env, ampClient, tail, log);
  const pings = new PingWatch(ampClient, tail, () => limbo.actionCtx, log);
  const pregenWatch = new PregenWatch(tail);
  const pregen = new Pregen(ampClient, tail, pregenWatch, () => limbo.actionCtx, {
    load: async () => ((await db.setting.findUnique({ where: { key: PLAN_KEY } }))?.value as PregenPlan | undefined) ?? { mode: "off", area: null },
    save: async (p) => {
      await db.setting.upsert({ where: { key: PLAN_KEY }, create: { key: PLAN_KEY, value: p }, update: { value: p } });
    },
  }, log, undefined, undefined, { tps: () => poller.fresh()?.tps ?? null, players: () => poller.fresh()?.players.length ?? null });
  pregenRoutes(app, tail, pregen, () => poller.fresh()?.players.length ?? null);
  const online = new OnlineWatch(ampClient, tail, () => limbo.actionCtx, () => poller.fresh()?.ampPlayers ?? null, log);
  const poller: StatusPoller = new StatusPoller(ampClient, tail, env.AMP_MOCK === "1" ? null : prismaSnapshotStore, log, undefined, () => pings.current());
  const restarts = new RestartSchedule(ampClient, () => limbo.actionCtx, log, () => pregen.quiesce());
  // docs/13 §12: one set of words for the server's state, and wake on Play.
  const wake = new Wake(ampClient, (a) => audit(a as Parameters<typeof audit>[0]));
  let tunnelUp: boolean | null = null;
  const view = new ServerView({ poller, wake, lastDown: () => recorder.lastDown, sleep: () => ({ on: pregen.sleep.on, delayMin: pregen.sleep.delayMin }), tunnelUp: () => tunnelUp });
  poller.stateName = (live) => (wake.waking && live.stateCode !== 20 ? "Waking" : live.state);
  statusRoutes(app, ampClient, poller, tail, () => pings.current(), view);
  wakeRoutes(app, wake, view);
  playerRoutes(app, ampClient, tail, limbo, () => pregen.quiesce());
  serverRoutes(app, ampClient, tail, restarts);
  fileRoutes(app, ampClient);
  consoleRoutes(app, ampClient, tail, () => limbo.actionCtx);
  const editor = new InventoryEditor(ampClient, tail, () => limbo.actionCtx, new Catalogue(`${env.REPO_DIR}/dist/items/catalogue.json`), (a) => audit(a as Parameters<typeof audit>[0]));
  inventoryRoutes(app, ampClient, tail, () => limbo.actionCtx, pregenWatch, undefined, editor);
  // The country of an address, for the web's admin sign-in log lines (web has no GeoLite file of its own).
  app.get("/geo", async (req) => ({ country: await countryOf(String((req.query as { ip?: unknown }).ip ?? ""), env.GEOIP_DB) }));

  // docs/16: sessions and the event log, fed by the console tail and the status poller.
  const recorder = new Recorder({
    store: prismaRecorderStore,
    privacy: () => getSection("privacy"),
    country: (ip) => countryOf(ip, env.GEOIP_DB),
    uuidOf: (name) => tail.uuidByName.get(name),
    log,
  });
  let housekeeping: NodeJS.Timeout | null = null;
  let watching: NodeJS.Timeout | null = null;

  app.addHook("onReady", async () => {
    if (env.AMP_MOCK === "1") return;
    await recorder.init().catch((err) => log({ err: String(err) }, "could not load open sessions"));
    tail.on(recorder.onConsole);
    poller.onStatus(recorder.onStatus);
    poller.onStatus((next) => {
      view.observe(next);
      void wake.update(next.stateCode).catch((err) => log({ err: String(err) }, "wake update failed"));
    });
    // "Crashed" survives a restart of the api: the newest up/down row says how the server last went down.
    const last = await db.event.findFirst({ where: { kind: { in: ["SERVER_START", "SERVER_STOP", "CRASH"] } }, orderBy: { at: "desc" }, select: { kind: true, meta: true } }).catch(() => null);
    if (last?.kind === "CRASH") recorder.lastDown = "crash";
    // Every 10 s: a wake that ran out of time fails even when AMP is out of reach, and losing or regaining AMP
    // goes into the event log in the same words the site shows. The sleep delay is read again every 10 min.
    let reachable: boolean | null = null;
    let sleepLooked = 0;
    watching = setInterval(() => {
      void (async () => {
        const live = poller.fresh();
        await wake.update(live?.stateCode ?? null);
        tunnelUp = live ? true : await tcpReachable(env.AMP_TUNNEL_IP, 22);
        const now = live !== null;
        if (reachable !== null && now !== reachable) {
          await prismaRecorderStore.addEvent(now
            ? { at: new Date(), kind: "WARN", actor: null, message: "The portal can reach the server again", meta: {} }
            : { at: new Date(), kind: "ERROR", actor: null, message: `Can't reach the server (${reasonFor(poller.lastError, tunnelUp)})`, meta: { error: poller.lastError } });
        }
        reachable = now;
        if (now && Date.now() - sleepLooked > 10 * 60_000) {
          sleepLooked = Date.now();
          await pregen.lookAtSleep();
        }
      })().catch((err) => log({ err: String(err) }, "status watch failed"));
    }, 10_000);
    tail.start();
    poller.start();
    limbo.start();
    pings.start();
    online.start();
    pregenWatch.start();
    await pregen.start();
    const keepHouse = () => void runRetentionIfDue(log).catch((err) => log({ err: String(err) }, "retention failed"));
    housekeeping = setInterval(keepHouse, 30 * 60_000);
    setTimeout(keepHouse, 60_000).unref();
  });
  app.addHook("onClose", async () => {
    tail.stop();
    poller.stop();
    limbo.stop();
    pings.stop();
    online.stop();
    pregen.stop();
    restarts.stop();
    if (housekeeping) clearInterval(housekeeping);
    if (watching) clearInterval(watching);
  });
  return app;
}
