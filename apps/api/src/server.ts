import Fastify from "fastify";
import { CHANGES } from "./changelog.js";
import { AmpClient, MockAmp, type Amp } from "./amp/client.js";
import { HttpRouterDash, MockRouterDash, type RouterDash } from "./router/client.js";
import { protectedHost, routerRoutes } from "./routes/router.js";
import { fillAddresses, prismaAddressStore } from "./router/addresses.js";
import { installRoutes } from "./routes/installs.js";
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
import { DumpPush } from "./backup/dump-push.js";
import { allWell, HealthWatch } from "./status/health-watch.js";
import { signInRoutes } from "./routes/signin.js";
import { serverPack } from "./players/pack.js";
import { currentSeason } from "./seasons/files.js";
import { SeasonRecorder } from "./seasons/recorder.js";
import { prismaSeasonStore } from "./seasons/store.js";
import { listAdvancementFiles, readAdvancements } from "./seasons/advancements.js";
import { seasonRoutes } from "./routes/seasons.js";
import { BUILDS_KEY, buildRoutes, readUploads, type SavedBuild } from "./routes/builds.js";
import { builderRoutes } from "./routes/builder.js";
import { CLOCK_KEY, SeasonClock, type StoredClock } from "./test-mode/clock.js";
import { checkoutCommit } from "./test-mode/checkout.js";
import { DOOR_KEY } from "./test-mode/door.js";
import { testRoutes } from "./test-mode/routes.js";
import { build as apiBuild } from "./status/versions.js";
import { sitePack } from "./status/health-watch.js";

export function buildServer(env: Env, amp?: Amp, deps: { build?: typeof runBuild; router?: RouterDash } = {}) {
  const app = Fastify({ logger: { level: "info" }, trustProxy: false });
  // docs/42: the test server's own api. Everything it changes is behind this one flag; on live it is false.
  const testMode = env.TEST_MODE === "1";
  if (testMode && env.TEST_SUMMARY_TOKEN === env.API_SERVICE_TOKEN) throw new Error("api: TEST_SUMMARY_TOKEN must not be the service token: it would open every route");
  const ampClient: Amp = amp ?? (env.AMP_MOCK === "1"
    ? new MockAmp()
    : new AmpClient({ url: env.AMP_URL, username: env.AMP_USERNAME, password: env.AMP_PASSWORD, instanceId: env.AMP_INSTANCE_ID }));

  app.addHook("onRequest", serviceAuth(env.API_SERVICE_TOKEN, testMode && env.TEST_SUMMARY_TOKEN ? { "/test/summary": env.TEST_SUMMARY_TOKEN } : {}));
  app.addHook("onRequest", viaDiscordHook);
  // docs/21 + docs/22: the Discord feed and the bot are made further down; /health reads them when asked
  // `checks` (docs/32 §7 item 3): what the health watch found at its last round; `watch` is false when any is wrong
  app.get("/health", async () => ({ ...(await health(env, ampClient)), discordFeed: feed.feedState(), discordBot: bot ? bot.state() : "off", watch: allWell(healthWatch.checks) && healthWatch.signIns.view().failing.length === 0, checks: healthWatch.checks, signIn: healthWatch.signIns.view(), checkedAt: healthWatch.lookedAt?.toISOString() ?? null }));
  modpackRoutes(app, env, ampClient, deps.build, () => pregen.quiesce());

  // Console tail, status poller and the wait room run for the life of the process (docs/05, docs/14).
  const log = (o: unknown, m: string) => app.log.info(o, m);
  const tail = new ConsoleTail(ampClient, log);
  const limbo = new Limbo(env, ampClient, tail, log);
  const dumpPush = new DumpPush(env, log);
  // 2.1.0: the mod files the server loaded at each start, against the set PCs get (modpack/server-mods.ts)
  const serverMods = new ServerMods(ampClient, env.REPO_DIR, log);
  serverMods.start(tail);
  app.get("/modpack/server-mods", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    if ((req.query as { fresh?: string }).fresh === "1") await serverMods.capture();
    return (await db.setting.findUnique({ where: { key: SERVER_MODS_KEY } }))?.value ?? null;
  });
  const pings = new PingWatch(ampClient, tail, () => limbo.actionCtx, log, undefined, () => poller.fresh() !== null);
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
  const healthWatch = new HealthWatch({
    amp: ampClient, dumpsDir: process.env.DB_DUMPS_DIR ?? "/dbdumps", repoDir: env.REPO_DIR,
    copied: () => dumpPush.last, serverPack, wake: () => wake.view(),
    addEvent: (e) => prismaRecorderStore.addEvent(e), log, testServer: testMode,
  });
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
      const keep = (await getSection("privacy").catch(() => null))?.chat ?? true; // the switch that rules game chat in the log
      const r = await runAction(ampClient, limbo.actionCtx, "chat.fromDiscord", { ...line, log: keep }, line.member);
      return r.ok ? "sent" : "failed";
    },
    memberChanged: (id, inGuild) => limbo.memberChanged(id, inGuild),
  });
  const hook = (url: string | undefined) => (url ? new Webhook(url, { botToken: env.DISCORD_BOT_TOKEN }) : null);
  const portal = env.PORTAL_URL.replace(/\/+$/, "");
  const feed = new Announcer({
    store: prismaFeedStore(portal, env.REPO_DIR), feed: hook(env.DISCORD_WEBHOOK_FEED), admin: hook(env.DISCORD_WEBHOOK_ADMIN), updates: hook(env.DISCORD_WEBHOOK_UPDATES),
    // docs/42 §3: the test server posts no change log
    bot: bot ? votePoster(bot) : null, chatRelay: Boolean(bot), changes: testMode ? [] : CHANGES, portal, log: (o, m) => app.log.info(o, m),
  });
  discordRoutes(app, feed, bot, env);
  installRoutes(app);
  poller.stateName = (live) => (wake.waking && live.stateCode !== 20 ? "Waking" : live.state);
  statusRoutes(app, ampClient, poller, tail, () => pings.current(), view);
  wakeRoutes(app, wake, view);
  signInRoutes(app, healthWatch);
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
  const routerDash = deps.router ?? (env.AMP_MOCK === "1" ? new MockRouterDash() : new HttpRouterDash(env.ROUTER_DASH_URL));
  routerRoutes(app, routerDash, env.SERVER_ADDRESS, testMode); // Admin → Server → Router; read only on the test server
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
  // docs/34 §4 (W1.3): the season's clears and what a season says, from the same console lines. It does nothing
  // until a Season row says "running" (Admin → Seasons, W1.4).
  const seasonFile = currentSeason(env.REPO_DIR, log);
  // docs/42 §7.1: the season's time. On live it is the real time; on the test server the test clock, once set.
  const clock = new SeasonClock(testMode, {
    load: async () => (await db.setting.findUnique({ where: { key: CLOCK_KEY } }))?.value ?? null,
    save: async (v: StoredClock | null) => {
      if (v) await db.setting.upsert({ where: { key: CLOCK_KEY }, create: { key: CLOCK_KEY, value: v }, update: { value: v } });
      else await db.setting.deleteMany({ where: { key: CLOCK_KEY } });
    },
  });
  buildRoutes(app, {
    amp: ampClient, tail, ctx: () => limbo.actionCtx,
    uploads: () => readUploads(`${env.REPO_DIR}/dist`),
    book: {
      load: async () => ((await db.setting.findUnique({ where: { key: BUILDS_KEY } }))?.value as SavedBuild[] | undefined) ?? [],
      save: async (list) => {
        await db.setting.upsert({ where: { key: BUILDS_KEY }, create: { key: BUILDS_KEY, value: JSON.parse(JSON.stringify(list)) }, update: { value: JSON.parse(JSON.stringify(list)) } });
      },
    },
  });
  builderRoutes(app, { amp: ampClient, tail, ctx: () => limbo.actionCtx, findUser: (id) => db.user.findUnique({ where: { id }, select: { id: true, role: true, builderTools: true, mcUsername: true } }) }); // docs/37
  seasonRoutes(app, { amp: ampClient, tail, ctx: () => limbo.actionCtx, file: seasonFile, store: prismaSeasonStore, addEvent: (e) => prismaRecorderStore.addEvent(e), settle: () => seasons.settle(), now: clock.now }); // settle: docs/35 R-15
  const seasons = new SeasonRecorder({
    file: seasonFile,
    store: prismaSeasonStore,
    uuidOf: async (name) => tail.uuidByName.get(name)?.toLowerCase() ?? (await prismaRecorderStore.uuidByName(name)),
    addEvent: (e) => prismaRecorderStore.addEvent(e),
    advancements: async () => {
      if (tail.state !== 20) return null;
      const files = await listAdvancementFiles(ampClient);
      return files ? (uuid) => readAdvancements(ampClient, uuid, files.get(uuid) ?? 0, log) : null;
    },
    log,
    now: clock.now,
    seasonTime: clock.shift,
  });
  testRoutes(app, {
    on: testMode, amp: ampClient, tail, ctx: () => limbo.actionCtx, clock, file: seasonFile, store: prismaSeasonStore,
    server: () => ({ state: view.state(), players: poller.fresh()?.players ?? [] }),
    address: env.SERVER_ADDRESS ?? null,
    commits: async () => ({ images: apiBuild().commit, checkout: await checkoutCommit(env.REPO_DIR) }),
    pack: async () => ({ site: await sitePack(env.REPO_DIR), server: await serverPack() }),
    door: {
      load: async () => (await db.setting.findUnique({ where: { key: DOOR_KEY } }))?.value ?? null,
      save: async (v) => {
        await db.setting.upsert({ where: { key: DOOR_KEY }, create: { key: DOOR_KEY, value: v }, update: { value: v } });
      },
    },
    dropSeason: async (id) => {
      await db.season.deleteMany({ where: { id } });
    },
    forget: () => seasons.forget(),
  });
  let housekeeping: NodeJS.Timeout | null = null;
  let watching: NodeJS.Timeout | null = null;
  let seasonClock: NodeJS.Timeout | null = null;
  let seasonFiles: NodeJS.Timeout | null = null;
  let addresses: NodeJS.Timeout | null = null;

  app.addHook("onReady", async () => {
    await clock.load().catch((err) => log({ err: String(err) }, "could not read the test clock"));
    if (env.AMP_MOCK === "1") return;
    await recorder.init().catch((err) => log({ err: String(err) }, "could not load open sessions"));
    tail.on(recorder.onConsole);
    tail.onResync(() => recorder.reconcileNext());
    tail.on(seasons.onConsole);
    // the safety net (docs/34 §4): the players' advancement files, soon after every server start and every ten
    // minutes while somebody is on; the clock, once a minute
    tail.on((e, info) => {
      if (e.type === "started" && !info?.replay) setTimeout(() => void seasons.fromFiles(), 30_000).unref();
    });
    seasonFiles = setInterval(() => {
      if (tail.state === 20 && tail.online.size > 0) void seasons.fromFiles();
    }, 10 * 60_000);
    seasonClock = setInterval(() => void seasons.tick(), 60_000);
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
    let wakeWas: string = wake.phase;
    let sleepLooked = 0;
    watching = setInterval(() => {
      void (async () => {
        const live = poller.fresh();
        await wake.update(live?.stateCode ?? null);
        // a wake that has just failed (AMP refused the start, or three minutes without Running) is told at once
        if (wake.phase === "failed" && wakeWas !== "failed") void healthWatch.wakeFailed();
        wakeWas = wake.phase;
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
    if (!testMode) dumpPush.start(); // docs/42 T7: the test server has no dumps to copy
    healthWatch.start();
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
    // Where sessions came from, from mc-router's logins (router/addresses.ts); a failure is logged once an hour at most.
    let quietUntil = 0;
    const fillFromRouter = () => void (async () => {
      const [privacy, retention] = await Promise.all([getSection("privacy"), getSection("retention")]);
      const filled = await fillAddresses({ dash: routerDash, store: prismaAddressStore, host: protectedHost(env.SERVER_ADDRESS), ipDays: retention.ipDays, geo: privacy.geo, country: (ip) => countryOf(ip, env.GEOIP_DB) });
      if (filled) log({ filled }, "session addresses from mc-router");
    })().catch((err) => {
      if (Date.now() < quietUntil) return;
      quietUntil = Date.now() + 3600_000;
      log({ err: String(err) }, "session addresses from mc-router failed");
    });
    addresses = setInterval(fillFromRouter, 2 * 60_000);
    setTimeout(fillFromRouter, 20_000).unref();
  });
  app.addHook("onClose", async () => {
    tail.stop();
    dumpPush.stop();
    healthWatch.stop();
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
    if (seasonClock) clearInterval(seasonClock);
    if (seasonFiles) clearInterval(seasonFiles);
    if (addresses) clearInterval(addresses);
  });
  return app;
}
