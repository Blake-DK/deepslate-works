import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { isOpenFor, type Member } from "../shared/access.js";
import { wakeDecision } from "../shared/server-state.js";
import type { ServerView } from "../status/view.js";
import type { Wake } from "../status/wake.js";

// docs/13 §12 B: "wake", the member-level start. For any member the door would let in (open for them: admin, live,
// or early access), only while the server is Asleep. Switched off and Crashed still need an admin's Start.

export type WakeDeps = {
  member: (userId: string) => Promise<(Member & { displayName: string }) | null>;
  live: () => Promise<boolean>;
};

export const dbWakeDeps: WakeDeps = {
  member: (id) => db.user.findUnique({ where: { id }, select: { role: true, earlyAccess: true, displayName: true } }),
  live: async () => (await db.siteSettings.findUnique({ where: { id: "site" }, select: { live: true } }).catch(() => null))?.live ?? false,
};

const REFUSED: Record<string, [number, string]> = {
  not_member: [403, "Sign in as a member of the group first."],
  not_open: [403, "The server isn't open for you yet."],
  off: [409, "The server is switched off, so it can't be woken. Ask Alex in Discord."],
  crashed: [409, "The server has crashed, so it can't be woken. Ask Alex in Discord."],
  unreachable: [503, "The site can't reach the server right now."],
  busy: [409, "The server is already starting, stopping or restarting."],
};

export function wakeRoutes(app: FastifyInstance, wake: Wake, view: ServerView, deps: WakeDeps = dbWakeDeps) {
  app.get("/server/wake", async () => ({ server: view.state(), wake: wake.view() }));

  app.post("/server/wake", async (req, reply) => {
    const id = req.caller.userId;
    const who = id && (req.caller.role === "ADMIN" || req.caller.role === "PLAYER") ? await deps.member(id) : null;
    const state = view.state();
    const decision = wakeDecision({ member: Boolean(who), openFor: who ? isOpenFor(who, await deps.live()) : false, state });
    if (decision === "start") {
      try {
        const asked = (req.body as { via?: unknown } | null)?.via;
        const via = asked === "app" ? "app" : asked === "discord" ? "discord" : "play"; // docs/22: /wake
        await wake.start(id!, who!.displayName, via);
      } catch (e) {
        return reply.code(502).send({ error: { code: "amp_error", message: e instanceof Error ? e.message : String(e) }, wake: wake.view() });
      }
      return reply.code(202).send({ result: "started", server: "waking", wake: wake.view() });
    }
    if (decision === "already" || decision === "awake") return { result: decision, server: state, wake: wake.view() };
    const [code, message] = REFUSED[decision]!;
    return reply.code(code).send({ error: { code: decision, message }, server: state, wake: wake.view() });
  });
}
