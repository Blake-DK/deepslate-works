import type { FastifyInstance } from "fastify";
import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import { toLive, type LiveStatus, type StatusPoller } from "../status/poller.js";
import type { ServerView } from "../status/view.js";

export function statusRoutes(app: FastifyInstance, amp: Amp, poller?: StatusPoller, tail?: ConsoleTail, pings: () => Record<string, number> = () => ({}), view?: ServerView) {
  // Served from the poller's last answer (at most 10 s old); AMP is only asked directly when that is stale.
  // docs/13 §12: when AMP cannot be reached at all, the answer is still 200, with `server: "unreachable"` and the
  // reason, so the site never shows that as "offline" or "switched off".
  app.get("/status", async (_req, reply) => {
    let live: LiveStatus | null = poller?.fresh() ?? null;
    let error: string | null = null;
    if (!live) {
      try {
        live = toLive(await amp.getStatus(), tail ?? null, new Date(), pings());
      } catch (e) {
        error = String(e instanceof Error ? e.message : e);
      }
    }
    if (!view) return live ?? reply.code(502).send({ error: { code: "amp_error", message: error ?? "no status" } });
    const extra = view.extra(live);
    if (live) return { ...live, ...extra };
    return { state: "Unknown", stateCode: null, availability: "offline", players: [], online: [], maxPlayers: null, cpu: null, memMb: null, memMaxMb: null, tps: null, uptime: null, at: new Date().toISOString(), ...extra };
  });
}
