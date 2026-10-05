import type { FastifyInstance } from "fastify";
import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import { toLive, type LiveStatus, type StatusPoller } from "../status/poller.js";
import type { ServerView } from "../status/view.js";

export function statusRoutes(app: FastifyInstance, amp: Amp, poller?: StatusPoller, tail?: ConsoleTail, pings: () => Record<string, number> = () => ({}), view?: ServerView) {
  // Served from the poller's last answer (at most 10 s old); AMP is only asked directly when that is stale.
  // docs/13 §12: when AMP cannot be reached at all, the answer is still 200, with `server: "unreachable"` and the
  // reason, so the site never shows that as "offline" or "switched off".
  // One question to AMP at a time, shared by every request that is waiting for it.
  let asking: Promise<LiveStatus> | null = null;
  const ask = () => (asking ??= amp.getStatus().then((s) => toLive(s, tail ?? null, new Date(), pings())).finally(() => { asking = null; }));

  app.get("/status", async (_req, reply) => {
    let live: LiveStatus | null = poller?.fresh() ?? null;
    let error: string | null = null;
    // The poller's last try failed (it tries every 10 s): AMP is not asked again here. Each page would wait out AMP's
    // 10 s timeout, and web gives up after 8 s with an error instead of "unreachable" (docs/35 R-13).
    if (!live && poller?.lastError) error = poller.lastError;
    else if (!live) {
      try {
        live = await ask();
      } catch (e) {
        error = String(e instanceof Error ? e.message : e);
      }
    }
    if (!view) return live ?? reply.code(502).send({ error: { code: "amp_error", message: error ?? "no status" } });
    const extra = view.extra(live);
    if (live) return { ...live, ...extra };
    return { state: "Unknown", stateCode: null, availability: "offline", players: [], ampPlayers: [], online: [], maxPlayers: null, cpu: null, memMb: null, memMaxMb: null, tps: null, uptime: null, at: new Date().toISOString(), ...extra };
  });
}
