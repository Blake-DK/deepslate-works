import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import type { ActionCtx } from "../actions/registry.js";
import { SEASON_ID } from "../actions/registry.js";
import { runAction } from "../actions/run.js";
import { audit } from "../audit.js";
import { requireAdmin } from "../auth.js";
import type { SeasonStore } from "../seasons/store.js";
import { names, type SeasonFile } from "../shared/season.js";
import type { ServerState } from "../shared/server-state.js";
import type { SeasonClock } from "./clock.js";
import { readTestDoor, type TestDoor } from "./door.js";

// docs/42: what only the test server's api answers. With TEST_MODE unset every route here says 404 and does nothing.
//
//   GET  /test/summary       the live site's Control Room card (T9). Its own token, TEST_SUMMARY_TOKEN, and no other
//                            (auth.ts serviceAuth); that token opens nothing but this.
//   GET  /test/state         the test site: its stripe, footer and test tools
//   POST /test/clock         "Pretend it is" / "Back to the real time" (§7.1), admins
//   POST /test/door          the door's three switches on the test server (T8), admins
//   POST /test/season-reset  Reset the season test (§7.2), admins

export type TestRouteDeps = {
  on: boolean;
  amp: Amp;
  tail: ConsoleTail;
  ctx: () => ActionCtx;
  clock: SeasonClock;
  file: () => Promise<SeasonFile | null>;
  store: SeasonStore;
  server: () => { state: ServerState; players: string[] };
  address: string | null;
  commits: () => Promise<{ images: string | null; checkout: string | null }>;
  pack: () => Promise<{ site: string | null; server: string | null }>;
  door: { load: () => Promise<unknown>; save: (d: TestDoor) => Promise<void> };
  /** Deletes the season's row; its clears go with it (SeasonClear is deleted on cascade). */
  dropSeason: (id: string) => Promise<void>;
  /** The recorder forgets the groups and wakes it holds in memory. */
  forget: () => void;
};

/** The quick buttons beside the test clock (§7.1), worked out from the season file and the season's time now. */
export function quickTimes(file: SeasonFile, now: Date): { opening: string; nextDrop: string | null; finale: string | null } {
  const t = now.getTime();
  const drops = [...file.trials.map((x) => x.opensAt), ...file.bosses.flatMap((b) => (b.opensAt ? [b.opensAt] : []))].filter((at) => Date.parse(at) > t).sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    opening: file.startsAt,
    nextDrop: drops[0] ?? null,
    finale: file.finale ? new Date(Date.parse(file.finale.at) - 5 * 60_000).toISOString() : null,
  };
}

const clockBody = z.union([z.object({ at: z.string().datetime() }), z.object({ clear: z.literal(true) })]);
const doorBody = z.object({ playFirst: z.boolean(), mustVote: z.boolean(), newestApp: z.boolean() });
const resetBody = z.object({ season: SEASON_ID });
// the clock stays within a few years of now: a typo of a year should not put the season clock in another century
const CLOCK_RANGE_MS = 3 * 365 * 86_400_000;

export function testRoutes(app: FastifyInstance, d: TestRouteDeps) {
  const refuse = (reply: FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });
  const notHere = (reply: FastifyReply) => refuse(reply, 404, "not_test", "Only the test server has this.");

  const season = async () => {
    const file = await d.file();
    if (!file) return null;
    const row = await d.store.season(file.id);
    return { id: file.id, name: file.name, state: row?.state ?? null, startsAt: file.startsAt, endsAt: file.endsAt, quick: quickTimes(file, d.clock.now()) };
  };

  app.get("/test/summary", async (_req, reply) => {
    if (!d.on) return notHere(reply);
    const s = d.server();
    const [commits, pack, current] = await Promise.all([d.commits(), d.pack(), season()]);
    return {
      state: s.state, players: s.players, address: d.address, ...commits, pack,
      season: current ? { id: current.id, name: current.name, state: current.state } : null,
      clock: d.clock.view(),
    };
  });

  app.get("/test/state", async (_req, reply) => {
    if (!d.on) return notHere(reply);
    const [commits, current, door] = await Promise.all([d.commits(), season(), d.door.load().catch(() => null)]);
    return { clock: d.clock.view(), ...commits, season: current, door: readTestDoor(door) };
  });

  app.post("/test/clock", async (req, reply) => {
    if (!d.on) return notHere(reply);
    if (!(await requireAdmin(req, reply))) return;
    const body = clockBody.safeParse(req.body);
    if (!body.success) return refuse(reply, 400, "validation", "a time, or clear");
    if ("clear" in body.data) {
      await d.clock.clear();
      await audit({ userId: req.caller.userId, action: "test.clock", params: { clear: true }, result: "OK" });
      return { ok: true, clock: d.clock.view() };
    }
    const at = new Date(body.data.at);
    if (Math.abs(at.getTime() - Date.now()) > CLOCK_RANGE_MS) return refuse(reply, 400, "validation", "The test clock stays within three years of today.");
    await d.clock.set(at);
    await audit({ userId: req.caller.userId, action: "test.clock", params: { at: at.toISOString() }, result: "OK" });
    return { ok: true, clock: d.clock.view() };
  });

  app.post("/test/door", async (req, reply) => {
    if (!d.on) return notHere(reply);
    if (!(await requireAdmin(req, reply))) return;
    const body = doorBody.safeParse(req.body);
    if (!body.success) return refuse(reply, 400, "validation", "three switches");
    await d.door.save(body.data);
    await audit({ userId: req.caller.userId, action: "test.door", params: body.data, result: "OK" });
    return { ok: true, door: body.data };
  });

  app.post("/test/season-reset", async (req, reply) => {
    if (!d.on) return notHere(reply);
    if (!(await requireAdmin(req, reply))) return;
    const body = resetBody.safeParse(req.body);
    if (!body.success) return refuse(reply, 400, "validation", "the season's id");
    const file = await d.file();
    if (!file) return refuse(reply, 409, "no_season", "There is no current season.");
    const by = req.caller.userId;
    const denied = async (message: string) => {
      await audit({ userId: by, action: "season.testReset", params: { season: body.data.season }, result: "DENIED", detail: message });
      return refuse(reply, 409, "not_now", message);
    };
    if (body.data.season !== file.id) return denied(`The current season is ${file.name}, not ${body.data.season}. Reload the page.`);
    if (d.tail.state !== 20) return denied("Start the test server first: the game's own ticks are taken back with commands, and only a running server takes them.");
    // the game keeps a player's ticks in their file while they are away, and the safety net would give them back
    const clears = await d.store.clears(file.id);
    const on = new Set([...d.tail.online].map((n) => n.toLowerCase()));
    const away = [...new Set(clears.map((c) => c.mcName))].filter((n) => !on.has(n.toLowerCase()));
    if (away.length > 0) return denied(`${names(away)} ${away.length === 1 ? "has" : "have"} ticks in ${file.name} and ${away.length === 1 ? "is" : "are"} not on the server. The game keeps those ticks in their file, so they would come back: ask them to join, then reset.`);
    const r = await runAction(d.amp, d.ctx(), "season.testReset", { season: file.id, bosses: file.bosses.map((b) => b.id) }, by);
    if (!r.ok) {
      await audit({ userId: by, action: "season.testReset", params: { season: file.id, name: file.name, sent: r.commands }, result: "FAILED", detail: r.detail ?? null });
      return refuse(reply, 502, "amp_error", r.detail ?? "The server did not take the commands.");
    }
    await d.dropSeason(file.id);
    d.forget();
    await d.clock.clear();
    await audit({ userId: by, action: "season.testReset", params: { season: file.id, name: file.name, clears: clears.length }, result: "OK" });
    return { ok: true, cleared: clears.length };
  });
}
