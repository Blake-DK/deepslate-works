import Fastify from "fastify";
import { AmpClient, MockAmp, type Amp } from "./amp/client.js";
import { BACKUP_JOB_KEY, BackupWatch, type BackupJob } from "./status/backup-watch.js";
import { serviceAuth } from "./auth.js";
import type { Env } from "./env.js";
import { health, tcpReachable } from "./health.js";
import { audit, viaDiscordHook } from "./audit.js";
import { Wake } from "./status/wake.js";
import { ServerView, reasonFor } from "./status/view.js";
import { PollWatch, pollRoutes } from "./players/polls.js";
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
import { brandingRoutes } from "./routes/branding.js";
import { ServerVersions } from "./status/versions.js";
import { versionRoutes } from "./routes/version.js";
import { Distances } from "./status/distance.js";
import { distanceRoutes } from "./routes/distance.js";
import { GroundItems, PLAN_KEY as GROUND_KEY, type GroundPlan } from "./status/ground.js";
import { groundRoutes } from "./routes/ground.js";
import { PartyBook } from "./players/parties.js";
import { partyRoutes } from "./routes/parties.js";
import { Recorder } from "./events/recorder.js";
import { prismaRecorderStore } from "./events/store.js";
import { countryOf } from "./events/geo.js";
import { runRetentionIfDue } from "./events/retention.js";
import { requireAdmin } from "./auth.js";
import { ServerMods, SERVER_MODS_KEY } from "./modpack/server-mods.js";
import { getSection } from "./settings.js";
import { Announcer } from "./discord/announcer.js";
import { prismaFeedStore } from "./discord/store.js";
import { Webhook } from "./discord/webhook.js";
import { discordRoutes } from "./routes/discord.js";
import { makeBot, votePoster } from "./discord/wire.js";
import { runAction } from "./actions/run.js";

export function buildServer(env: Env, amp?: Amp, deps: { build?: typeof runBuild } = {}) {
  const app = Fastify({ logger: { level: "info" }, trustProxy: false });
  const ampClient: Amp = amp ?? (env.AMP_MOCK === "1"
    ? new MockAmp()
    : new AmpClient({ url: env.AMP_URL, username: env.AMP_USERNAME, password: env.AMP_PASSWORD, instanceId: env.AMP_INSTANCE_ID }));

  app.addHook("onRequest", serviceAuth(env.API_SERVICE_TOKEN));
  app.addHook("onRequest", viaDiscordHook);
  // docs/21 + docs/22: the Discord feed and the bot are made further down; /health reads them when asked
  app.get("/health", async () => ({ ...(await health(env, ampClient)), discordFeed: feed.feedState(), discordBot: bot ? bot.state() : "off" }));
  modpackRoutes(app, env, ampClient, deps.build, () => pregen.quiesce());

  // Console tail, status poller and the wait room run for the life of the process (docs/05, docs/14).
  const log = (o: unknown, m: string) => app.log.info(o, m);
  const tail = new ConsoleTail(ampClient, log);
  const limbo = new Limbo(env, ampClient, tail, log);
  // 2.1.0: the mod files the server loaded at each start, against the set PCs get (modpack/server-mods.ts)
  const serverMods = new ServerMods(ampClient, env.REPO_DIR, log);
  serverMods.start(tail);
  app.get("/modpack/server-mods", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if ((req.query as { fresh?: string }).fresh === "1") await serverMods.capture();
    return (await db.setting.findUnique({ where: { key: SERVER_MODS_KEY } }))?.value ?? null;
  });
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
  // docs/22: the bot (only with DISCORD_BOT_TOKEN and DISCORD_GUILD_ID), and docs/21's feed, which posts its votes
  const bot = makeBot({
    app, env, log,
    server: () => {
      const live = poller.fresh();
      const extra = view.extra(live);
      return { state: extra.server, players: live?.players ?? [], tps: live?.tps ?? null, sleepInMin: extra.sleepInMin };
    },
    async toGame(line) {
      // nobody on: nothing is sent and the server is not woken (docs/22 §5)
      if (tail.state !== 20 || tail.online.size === 0) return "nobody";
      const r = await runAction(ampClient, limbo.actionCtx, "chat.fromDiscord", line, line.member);
      return r.ok ? "sent" : "failed";
    },
    memberChanged: (id, inGuild) => limbo.memberChanged(id, inGuild),
  });
  const hook = (url: string | undefined) => (url ? new Webhook(url, { botToken: env.DISCORD_BOT_TOKEN }) : null);
  const portal = env.PORTAL_URL.replace(/\/+$/, "");
  const feed = new Announcer({
    store: prismaFeedStore(portal), feed: hook(env.DISCORD_WEBHOOK_FEED), admin: hook(env.DISCORD_WEBHOOK_ADMIN), updates: hook(env.DISCORD_WEBHOOK_UPDATES),
    bot: bot ? votePoster(bot) : null, chatRelay: Boolean(bot), portal, log: (o, m) => app.log.info(o, m),
  });
  discordRoutes(app, feed, bot, env);
  poller.stateName = (live) => (wake.waking && live.stateCode !== 20 ? "Waking" : live.state);
  statusRoutes(app, ampClient, poller, tail, () => pings.current(), view);
  wakeRoutes(app, wake, view);
  const polls = new PollWatch(log);
  pollRoutes(app, ampClient, tail, () => limbo.actionCtx);
  playerRoutes(app, ampClient, tail, limbo, () => pregen.quiesce());
  const backups = new BackupWatch(ampClient, {
    load: async () => ((await db.setting.findUnique({ where: { key: BACKUP_JOB_KEY } }))?.value as BackupJob | undefined) ?? null,
    save: async (j) => {
      await db.setting.upsert({ where: { key: BACKUP_JOB_KEY }, create: { key: BACKUP_JOB_KEY, value: j }, update: { value: j } });
    },
  }, (a) => audit(a), { log });
  void backups.init();
  serverRoutes(app, ampClient, tail, restarts, backups);
  brandingRoutes(app, env, ampClient, deps.build);
  const serverVersions = new ServerVersions(ampClient, tail);
  versionRoutes(app, serverVersions);
  const distances = new Distances(ampClient, tail, () => limbo.actionCtx, restarts, log);
  distanceRoutes(app, distances);
  const ground = new GroundItems(ampClient, tail, () => limbo.actionCtx, {
    load: async () => (await db.setting.findUnique({ where: { key: GROUND_KEY } }))?.value,
    save: async (p: GroundPlan) => {
      await db.setting.upsert({ where: { key: GROUND_KEY }, create: { key: GROUND_KEY, value: p }, update: { value: p } });
    },
  }, (a) => audit(a as Parameters<typeof audit>[0]), log);
  groundRoutes(app, ground);
  partyRoutes(app, new PartyBook(ampClient));
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
    distances.start();
    ground.start();
    polls.start();
    feed.start();
    bot?.start();
    serverVersions.start();
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
    polls.stop();
    feed.stop();
    bot?.stop();
    pregen.stop();
    restarts.stop();
    ground.stop();
    if (housekeeping) clearInterval(housekeeping);
    if (watching) clearInterval(watching);
  });
  return app;
}
