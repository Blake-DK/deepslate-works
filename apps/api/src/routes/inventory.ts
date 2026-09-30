import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import type { ActionCtx } from "../actions/registry.js";
import { runAction } from "../actions/run.js";
import { requireAdmin } from "../auth.js";
import { chunks } from "../files/browse.js";
import { NbtError, readNbt } from "../players/nbt.js";
import { toPlayerData } from "../players/inventory.js";
import type { InventoryEditor } from "../players/editor.js";
import { RateLimit } from "../console/limit.js";
import { MC_NAME } from "../actions/registry.js";

// docs/13, 2026-09-30: an admin sees a player's inventory, ender chest and state. Source: the game's own save of the
// player, world/playerdata/<uuid>.dat, read through AMP's file manager (the same read-only calls as Admin → Files).
// That file is on the file browser's deny list and stays there: this route reads exactly one file, named from a
// checked UUID, for an admin. "Refresh" asks the game to save first (save-all) and waits for "Saved the game".
// Chosen over `data get entity <name> Inventory`: it works while the player is offline, and it is NBT, not a line of
// console text with modded components in it to take apart.

export const WORLD = "world";
const MAX_BYTES = 4 * 1024 * 1024;
type AmpEntry = { IsDirectory?: boolean; Filename?: string; SizeBytes?: number; Modified?: string };
type Saved = { savedAt: number };

export function inventoryRoutes(app: FastifyInstance, amp: Amp, tail: ConsoleTail, ctx: () => ActionCtx, saved: Saved, wait = (ms: number) => new Promise((r) => setTimeout(r, ms)), editor?: InventoryEditor, limit = new RateLimit()) {
  app.get("/players/:uuid/data", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const uuid = z.string().uuid().safeParse((req.params as { uuid: string }).uuid);
    if (!uuid.success) return reply.code(400).send({ error: { code: "validation", message: "uuid" } });
    const id = uuid.data.toLowerCase();
    const q = req.query as { fresh?: string; live?: string; name?: string };
    const fresh = q.fresh === "1";
    // docs/13 §13: a player who is on is read as they are now (`data get entity`); anyone else from the save file
    const asked = MC_NAME.safeParse(q.name);
    const name = (asked.success ? asked.data : null) ?? [...tail.uuidByName.entries()].find(([, u]) => u.toLowerCase() === id)?.[0] ?? null;
    if (q.live === "1" && editor && name && editor.online(name)) {
      const data = await editor.live(name, req.caller.userId);
      if (data) return { data, savedAt: null, fresh: true, running: true, live: true, name };
    }

    let savedNow = false;
    if (fresh && tail.state === 20) {
      const asked = Date.now();
      const r = await runAction(amp, ctx(), "world.save", {}, req.caller.userId);
      for (let i = 0; r.ok && i < 20 && !savedNow; i++) {
        if (saved.savedAt >= asked) savedNow = true;
        else await wait(500);
      }
    }

    const dir = `${WORLD}/playerdata`;
    const listing = await amp.call<AmpEntry[] | { Title?: string; Message?: string }>("FileManagerPlugin", "GetDirectoryListing", { Dir: dir }).catch(() => null);
    if (!Array.isArray(listing)) return reply.code(502).send({ error: { code: "amp_error", message: "Could not list the player files on the server." } });
    const entry = listing.find((e) => e.Filename === `${id}.dat` && !e.IsDirectory);
    if (!entry) return reply.code(404).send({ error: { code: "not_found", message: "The server has no saved data for this player yet. They appear after their first time on." } });
    const size = Math.max(0, Number(entry.SizeBytes) || 0);
    if (size > MAX_BYTES) return reply.code(413).send({ error: { code: "too_large", message: "The player file is larger than expected." } });
    try {
      const parts: Buffer[] = [];
      for await (const c of chunks(amp, `${dir}/${id}.dat`, size, MAX_BYTES)) parts.push(c);
      const data = toPlayerData(readNbt(Buffer.concat(parts)));
      return { data, savedAt: entry.Modified ?? null, fresh: savedNow, running: tail.state === 20, live: false, name };
    } catch (e) {
      const message = e instanceof NbtError ? `The player file could not be read: ${e.message}.` : e instanceof Error ? e.message : String(e);
      return reply.code(502).send({ error: { code: "amp_error", message } });
    }
  });

  // docs/13 §13: change an online player's inventory or ender chest. Admins only, 5 changes a second at most.
  app.post("/players/:name/inventory", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!editor) return reply.code(503).send({ error: { code: "unconfigured", message: "no editor" } });
    const name = MC_NAME.safeParse((req.params as { name: string }).name);
    if (!name.success) return reply.code(400).send({ error: { code: "validation", message: "Minecraft name" } });
    if (!limit.take(req.caller.userId ?? "service")) return reply.code(429).send({ error: { code: "rate_limited", message: "More than 5 changes a second. Wait a moment." } });
    const body = (req.body ?? {}) as { op?: unknown; slot?: unknown; item?: unknown; count?: unknown; components?: unknown };
    const r = await editor.change(req.caller.userId ?? "service", name.data, {
      op: body.op as "set" | "clear" | "give",
      slot: typeof body.slot === "string" ? body.slot : undefined,
      item: typeof body.item === "string" ? body.item : undefined,
      count: typeof body.count === "number" ? body.count : undefined,
      components: typeof body.components === "string" ? body.components : undefined,
    });
    if (r.ok) return r;
    const status = r.code === "validation" ? 400 : r.code === "offline" || r.code === "server_offline" ? 409 : r.code === "no_answer" ? 504 : 422;
    return reply.code(status).send({ error: { code: r.code, message: r.message } });
  });
}
