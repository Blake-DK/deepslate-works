import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../auth.js";
import { db } from "../db.js";
import { TEST_MODES } from "../shared/join-gate.js";

// Install reports, read-only, for admins and for the VPS session (api.sh), which has no browser and does not read
// the production database (Alex, 2026-10-03). The site's own view is Admin → People → Installs, which reads the
// same rows inside web. Nothing here writes; reports arrive at web's POST /api/installer/report.
// No PC tier measured on a report means: no hardware in it to go on (game_check, log_sent, unfinished, uninstall,
// a minimal ping), see `tierMeasured`.

const list = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  user: z.string().trim().min(1).max(64).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  outcome: z.enum(["ok", "failed", "cancelled", "skipped"]).optional(),
  mode: z.string().regex(/^[a-z_]{1,32}$/).optional(),
});

const LOG_TAIL = 400; // lines; the whole log with ?full=1

export function installRoutes(app: FastifyInstance) {
  app.get("/installs", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const q = list.safeParse(req.query ?? {});
    if (!q.success) return reply.code(400).send({ error: { code: "validation", message: q.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } });
    const { limit, user, since, until, outcome, mode } = q.data;
    const rows = await db.installReport.findMany({
      where: {
        ...(since || until ? { at: { ...(since ? { gte: new Date(since) } : {}), ...(until ? { lte: new Date(until) } : {}) } } : {}),
        ...(outcome ? { outcome } : {}),
        ...(mode ? { mode } : { mode: { notIn: TEST_MODES } }), // docs/45: test Plays (and 3.6.1 their game checks) only when asked for by mode
        ...(user ? { user: { OR: [{ displayName: { contains: user, mode: "insensitive" } }, { mcUsername: { equals: user, mode: "insensitive" } }] } } : {}),
      },
      orderBy: { at: "desc" },
      take: limit,
      select: {
        id: true, at: true, mode: true, outcome: true, failedStep: true, installerVersion: true, updatedFrom: true, updateProblem: true,
        packVersion: true, durationSec: true, tierBefore: true, tierMeasured: true, minimal: true, playLinkMissing: true,
        user: { select: { displayName: true, mcUsername: true } },
      },
    });
    return { reports: rows.map(({ user: u, ...r }) => ({ ...r, who: u?.displayName ?? null, mcUsername: u?.mcUsername ?? null })) };
  });

  app.get("/installs/:id", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const id = z.string().regex(/^[a-z0-9]{8,40}$/).safeParse((req.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: { code: "validation", message: "id" } });
    const r = await db.installReport.findUnique({ where: { id: id.data }, include: { user: { select: { displayName: true, mcUsername: true } } } });
    if (!r) return reply.code(404).send({ error: { code: "not_found", message: "no such report" } });
    const full = (req.query as { full?: string }).full === "1";
    const lines = r.log.split("\n");
    const { user: u, ...rest } = r;
    return { ...rest, who: u?.displayName ?? null, mcUsername: u?.mcUsername ?? null, logLines: lines.length, log: full ? r.log : lines.slice(-LOG_TAIL).join("\n") };
  });
}
