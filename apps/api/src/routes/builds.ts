import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import { BUILD_DIMENSION, BUILD_NAME, MAX_BUILD_PIECES, MAX_BUILD_SIDE, buildBox, buildPieces, type ActionCtx, type Block } from "../actions/registry.js";
import { runAction } from "../actions/run.js";
import { requireAdmin } from "../auth.js";

// docs/34 §10 (T2 to T4): Admin → Seasons, "Builds". Capture takes something that stands in the world and keeps it
// under a name; Place puts a kept build somewhere, in the main world or a Frontier; Lock makes its ground a server
// claim. What has been captured is remembered here (its size is needed to place it again); the structure files
// themselves are the server's, in world/generated/deepslate/structures/, and outlive a Frontier's wipe.

export type SavedBuild = { name: string; size: Block; from: { dimension: string } & Block; at: string; by: string | null };
export type BuildBook = { load(): Promise<SavedBuild[]>; save(list: SavedBuild[]): Promise<void> };
export const BUILDS_KEY = "_builds";

const coord = z.number().int().min(-100_000).max(100_000);
const block = z.object({ x: coord, y: z.number().int().min(-64).max(318), z: coord });
const capture = z.object({ name: BUILD_NAME, dimension: BUILD_DIMENSION, from: block, to: block });
const place = z.object({ name: BUILD_NAME, dimension: BUILD_DIMENSION, at: block, lock: z.boolean().default(false) });

export function buildRoutes(app: FastifyInstance, d: { amp: Amp; tail: ConsoleTail; ctx: () => ActionCtx; book: BuildBook; now?: () => Date }) {
  const refuse = (reply: FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });
  const running = () => d.tail.state === 20;

  app.get("/builds", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { builds: await d.book.load(), running: running(), max: { side: MAX_BUILD_SIDE, pieces: MAX_BUILD_PIECES } };
  });

  app.post("/builds/capture", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = capture.safeParse(req.body);
    if (!body.success) return refuse(reply, 400, "validation", "A name (small letters, digits and _), a world and two corners.");
    if (!running()) return refuse(reply, 409, "server_offline", "The server is not running. Start it first.");
    const { size, min } = buildBox(body.data.from, body.data.to);
    if (Math.max(size.x, size.y, size.z) > MAX_BUILD_SIDE || buildPieces(size).length > MAX_BUILD_PIECES) return refuse(reply, 400, "too_large", `That is ${size.x} by ${size.y} by ${size.z} blocks. A build is ${MAX_BUILD_SIDE} blocks a side and ${MAX_BUILD_PIECES} pieces of 48 at most.`);
    if (min.y + size.y + 1 > 319) return refuse(reply, 400, "too_high", "There is no room above the build for the block that saves it. Lower the top corner by two.");
    const r = await runAction(d.amp, d.ctx(), "build.capture", body.data, req.caller.userId);
    if (!r.ok) return refuse(reply, 502, "amp_error", r.detail ?? "The server did not take the commands.");
    const saved: SavedBuild = { name: body.data.name, size, from: { dimension: body.data.dimension, ...min }, at: (d.now?.() ?? new Date()).toISOString(), by: req.caller.userId };
    await d.book.save([saved, ...(await d.book.load()).filter((b) => b.name !== saved.name)].slice(0, 100));
    return { ok: true, build: saved, pieces: buildPieces(size).length };
  });

  app.post("/builds/place", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = place.safeParse(req.body);
    if (!body.success) return refuse(reply, 400, "validation", "A build, a world and a position.");
    if (!running()) return refuse(reply, 409, "server_offline", "The server is not running. Start it first.");
    const build = (await d.book.load()).find((b) => b.name === body.data.name);
    if (!build) return refuse(reply, 404, "not_found", "No build has been captured under that name.");
    const { at, dimension } = body.data;
    if (at.y + build.size.y - 1 > 319) return refuse(reply, 400, "too_high", "The build would reach above the top of the world there.");
    const r = await runAction(d.amp, d.ctx(), "build.place", { name: build.name, dimension, at, size: build.size }, req.caller.userId);
    if (!r.ok) return refuse(reply, 502, "amp_error", r.detail ?? "The server did not take the commands.");
    let locked = false;
    if (body.data.lock) locked = (await runAction(d.amp, d.ctx(), "build.lock", { dimension, x1: at.x, z1: at.z, x2: at.x + build.size.x - 1, z2: at.z + build.size.z - 1 }, req.caller.userId)).ok;
    return { ok: true, pieces: buildPieces(build.size).length, locked };
  });
}
