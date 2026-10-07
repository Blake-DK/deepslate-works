import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import { SEASON_ID, type ActionCtx } from "../actions/registry.js";
import { runAction } from "../actions/run.js";
import { audit } from "../audit.js";
import { requireAdmin } from "../auth.js";
import type { NewEvent } from "../events/recorder.js";
import { clearKey, type SeasonStore } from "../seasons/store.js";
import { scoreboard, seasonResult, type SeasonFile } from "../shared/season.js";

// docs/34 §6 (W1.4): Admin → Seasons. Announce makes the season's row (the site shows "opens …" from then on),
// Start begins the recording, End freezes the result, once. Give and take back a tick: for a kill the portal
// missed or should not have counted. The member and the boss or trial are picked from lists; nothing is free text.

export type SeasonRouteDeps = {
  amp: Amp;
  tail: ConsoleTail;
  ctx: () => ActionCtx;
  file: () => Promise<SeasonFile | null>;
  store: SeasonStore;
  addEvent: (e: NewEvent) => Promise<unknown>;
  /** The recorder's `settle`: what it still holds is written and the files are read once more, before End freezes the result. */
  settle?: () => Promise<void>;
  now?: () => Date;
};

/** "Mon 30 Nov, 19:00" in UK time, as the site writes it (web's lib/uk-time.ts). */
function ukDayTime(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}, ${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
}
const tick = z.object({ userId: z.string().min(1).max(64), kind: z.enum(["boss", "trial"]), itemId: SEASON_ID });

export function seasonRoutes(app: FastifyInstance, d: SeasonRouteDeps) {
  const now = d.now ?? (() => new Date());
  const refuse = (reply: FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });
  const event = (file: SeasonFile, message: string, meta: Record<string, unknown>) => d.addEvent({ at: now(), kind: "SEASON", actor: null, message, meta: { season: file.id, ...meta } });

  app.get("/seasons", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const file = await d.file();
    if (!file) return { file: null, row: null, clears: 0, members: [], online: [] };
    const row = await d.store.season(file.id);
    const clears = row ? await d.store.clears(file.id) : [];
    return {
      file: { id: file.id, name: file.name, startsAt: file.startsAt, endsAt: file.endsAt, bosses: file.bosses.map((b) => ({ id: b.id, title: b.title })), trials: file.trials.map((t) => ({ id: t.id, title: t.title })) },
      row: row ? { state: row.state, hasResult: Boolean(row.result), revoked: row.marks.revoked ?? [] } : null,
      clears: clears.length,
      ticks: clears.map((c) => ({ kind: c.kind, itemId: c.itemId, mcUuid: c.mcUuid, mcName: c.mcName, first: c.first })),
      members: await d.store.linked(),
      online: [...d.tail.online],
    };
  });

  app.post("/seasons/:op", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const op = (req.params as { op: string }).op;
    const by = req.caller.userId;
    const file = await d.file();
    if (!file) return refuse(reply, 409, "no_season", "There is no current season: modpack/seasons/index.json names none, or its file does not read.");
    const row = await d.store.season(file.id);
    const params = { season: file.id, name: file.name };
    const denied = async (action: string, message: string) => {
      await audit({ userId: by, action, params, result: "DENIED", detail: message });
      return refuse(reply, 409, "not_now", message);
    };

    if (op === "announce") {
      if (row) return denied("season.announce", `${file.name} is announced already.`);
      // false: a second click made the row a moment ago
      if (!(await d.store.create({ id: file.id, name: file.name, startsAt: new Date(file.startsAt), endsAt: new Date(file.endsAt) }))) return denied("season.announce", `${file.name} is announced already.`);
      await event(file, `${file.name} is announced: it opens ${ukDayTime(new Date(file.startsAt))}`, { what: "announced" });
      await audit({ userId: by, action: "season.announce", params, result: "OK" });
      return { ok: true, state: "upcoming" };
    }

    if (op === "start") {
      if (row?.state === "running") return denied("season.start", `${file.name} is running already.`);
      if (row?.state === "ended") return denied("season.start", `${file.name} has ended. An ended season is not started again.`);
      const other = await d.store.runningOther(file.id);
      if (other) return denied("season.start", `Another season (${other}) is still running. End it first.`);
      if (!row) await d.store.create({ id: file.id, name: file.name, startsAt: new Date(file.startsAt), endsAt: new Date(file.endsAt) });
      await d.store.setState(file.id, "running");
      await event(file, `${file.name} has begun`, { what: "started" });
      await audit({ userId: by, action: "season.start", params, result: "OK" });
      return { ok: true, state: "running" };
    }

    if (op === "end") {
      if (row?.state !== "running") return denied("season.end", `${file.name} is not running.`);
      // the result is written once: a kill of the last seconds (the finale's) must be in the table before it is
      await d.settle?.().catch(() => undefined);
      const clears = await d.store.clears(file.id);
      const result = seasonResult(file, clears, now());
      if (!(await d.store.end(file.id, result))) return denied("season.end", `${file.name} has a result already. It is written once.`);
      const board = scoreboard(file, clears);
      const lead = board[0];
      const level = lead ? board.filter((r) => r.points === lead.points).map((r) => r.mcName) : [];
      const winner = !lead ? "" : level.length > 1 ? ` ${level.slice(0, -1).join(", ")} and ${level[level.length - 1]} share first place with ${lead.points} points.` : ` ${lead.mcName} wins with ${lead.points} points.`;
      await event(file, `${file.name} is over.${winner}`, { what: "ended", winners: level, points: lead?.points ?? 0 });
      await audit({ userId: by, action: "season.end", params: { ...params, players: board.length, clears: clears.length }, result: "OK" });
      return { ok: true, state: "ended" };
    }

    if (op === "reload") {
      if (d.tail.state !== 20) return denied("season.reload", "The server is not running.");
      const r = await runAction(d.amp, d.ctx(), "season.reload", {}, by);
      return r.ok ? { ok: true } : refuse(reply, 502, "amp_error", r.detail ?? "The server did not take the command.");
    }

    if (op === "grant" || op === "revoke") {
      const body = tick.safeParse(req.body);
      if (!body.success) return refuse(reply, 400, "validation", "member, boss or trial");
      if (!row || row.state === "upcoming") return denied(`season.${op}`, `${file.name} has not started.`);
      if (row.state === "ended") return denied(`season.${op}`, `${file.name} has ended; its result is frozen.`);
      const { userId, kind, itemId } = body.data;
      const item = kind === "boss" ? file.bosses.find((b) => b.id === itemId) : file.trials.find((t) => t.id === itemId);
      const member = (await d.store.linked()).find((m) => m.userId === userId);
      if (!item || !member) return refuse(reply, 404, "not_found", !item ? "This season has no such boss or trial." : "No such member, or their Minecraft account is not linked.");
      const kept = { ...params, kind, id: itemId, title: item.title, member: member.mcName };
      // the game's own tick, when they are on: the advancement, and with it the trophy
      const onNow = d.tail.state === 20 && [...d.tail.online].find((n) => n.toLowerCase() === member.mcName.toLowerCase());
      const inGame = onNow ? (await runAction(d.amp, d.ctx(), op === "grant" ? "season.grant" : "season.revoke", { name: onNow, season: file.id, kind, id: itemId }, by)).ok : false;
      if (op === "grant") {
        await d.store.unrevoke(file.id, clearKey(kind, itemId, member.mcUuid));
        const at = now();
        const { added, first } = await d.store.addClears(file.id, [{ kind, itemId, mcUuid: member.mcUuid, mcName: member.mcName, userId: member.userId, at, early: at < new Date(item.opensAt ?? file.startsAt), source: "admin" }]);
        await audit({ userId: by, action: "season.grant", params: { ...kept, inGame, already: added.length === 0, first }, result: "OK" });
        return { ok: true, added: added.length === 1, inGame };
      }
      const gone = await d.store.removeClear(file.id, kind, itemId, member.mcUuid);
      await audit({ userId: by, action: "season.revoke", params: { ...kept, inGame, had: gone }, result: "OK" });
      return { ok: true, removed: gone, inGame };
    }

    return refuse(reply, 404, "validation", "announce|start|end|reload|grant|revoke");
  });
}
