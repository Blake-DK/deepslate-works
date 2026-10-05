import { readFile, stat } from "node:fs/promises";
import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import type { ActionCtx, ActionName } from "../actions/registry.js";
import { runAction } from "../actions/run.js";
import { invReply, isChat, type InvReply } from "../events/parse.js";
import { clampCount, COMPONENTS_RE, invPhrase, ITEM_RE, SLOT_RE } from "../shared/slots.js";
import { toPlayerData, type PlayerData } from "./inventory.js";

// docs/13 §13 (planner, 2026-09-30): the admin's inventory and ender chest editor. Online players only; an offline
// player is never written (the save file stays the game's). Every change is one vanilla command from the action
// registry, one at a time, and counts only when the server has answered that it happened.

export type CatalogueItem = { id: string; name: string; mod: string; maxStack: number | null; icon: string | null };
export type Change = { op: "set" | "clear" | "give"; slot?: string; item?: string; count?: number; components?: string };
export type ChangeResult = { ok: true; reply: string; data: PlayerData | null } | { ok: false; code: "validation" | "offline" | "refused" | "no_answer" | "server_offline"; message: string };
type Audit = (a: { userId: string | null; action: string; params: Record<string, unknown>; result: string; detail?: string | null }) => Promise<unknown>;

const REPLY_MS = 4000;
const READ_MS = 5000;

export class Catalogue {
  private cache: { mtime: number; byId: Map<string, CatalogueItem> } | null = null;
  /** Stack sizes the server told us ("X can only stack up to 16"), for mod items the catalogue does not know. */
  learnt = new Map<string, number>();
  constructor(private readonly file: string) {}
  async byId(): Promise<Map<string, CatalogueItem>> {
    const m = (await stat(this.file).catch(() => null))?.mtimeMs ?? 0;
    if (!this.cache || this.cache.mtime !== m) {
      const raw = m ? (JSON.parse(await readFile(this.file, "utf8")) as { items: CatalogueItem[] }) : { items: [] };
      this.cache = { mtime: m, byId: new Map(raw.items.map((i) => [i.id, i])) };
    }
    return this.cache.byId;
  }
  async maxStack(id: string): Promise<number | null> {
    return this.learnt.get(id) ?? (await this.byId()).get(id)?.maxStack ?? null;
  }
}

/** Pure: is this change well formed, and what exactly is sent? */
export function checkChange(c: Change, known: (id: string) => boolean, maxStack: number | null): { ok: true; change: Required<Pick<Change, "op">> & Change } | { ok: false; message: string } {
  if (c.op !== "set" && c.op !== "clear" && c.op !== "give") return { ok: false, message: "set, clear or give" };
  if (c.op !== "give" && !(typeof c.slot === "string" && SLOT_RE.test(c.slot))) return { ok: false, message: "That is not a slot." };
  if (c.op === "clear") return { ok: true, change: { op: "clear", slot: c.slot } };
  if (!(typeof c.item === "string" && ITEM_RE.test(c.item) && known(c.item))) return { ok: false, message: `The server has no item "${String(c.item)}".` };
  if (c.components !== undefined && c.components !== "" && !COMPONENTS_RE.test(c.components)) return { ok: false, message: "Components go in square brackets, on one line." };
  const count = clampCount(Number(c.count ?? 1), maxStack);
  return { ok: true, change: { op: c.op, slot: c.slot, item: c.item, count, components: c.components || undefined } };
}

export class InventoryEditor {
  private waiters: Array<(text: string) => boolean> = [];
  private dumps = new Map<string, Array<(d: PlayerData) => void>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly amp: Amp,
    private readonly tail: ConsoleTail,
    private readonly ctx: () => ActionCtx,
    readonly catalogue: Catalogue,
    private readonly audit: Audit,
  ) {
    tail.on((e, info) => {
      if (info.replay) return;
      // never what a player says: "Gave 64 [Diamond] to samoyedx" can be typed in chat (docs/35 R-31)
      if (e.type === "line" && !isChat(e.text, { source: e.source, type: e.kind })) this.waiters = this.waiters.filter((w) => !w(e.text));
      if (e.type === "entitydata") {
        const wait = this.dumps.get(e.name.toLowerCase());
        if (wait) {
          this.dumps.delete(e.name.toLowerCase());
          const data = toPlayerData(e.data);
          for (const w of wait) w(data);
        }
      }
    });
  }

  online(name: string): boolean {
    return this.tail.state === 20 && [...this.tail.online].some((n) => n.toLowerCase() === name.toLowerCase());
  }

  private send(name: ActionName, input: object, by: string | null) {
    return runAction(this.amp, this.ctx(), name, input, by);
  }

  /** The player as they are now (`data get entity`), or null when they are not on or the server did not answer. */
  async live(name: string, by: string | null): Promise<PlayerData | null> {
    if (!this.online(name)) return null;
    const got = new Promise<PlayerData | null>((resolve) => {
      const key = name.toLowerCase();
      this.dumps.set(key, [...(this.dumps.get(key) ?? []), resolve]);
      setTimeout(() => resolve(null), READ_MS).unref?.();
    });
    if (!(await this.send("inv.read", { player: name }, by)).ok) return null;
    return got;
  }

  /** One change, after the one before it has had its answer. */
  change(by: string, player: string, c: Change): Promise<ChangeResult> {
    const run = this.queue.then(() => this.apply(by, player, c));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async apply(by: string, player: string, c: Change): Promise<ChangeResult> {
    if (this.tail.state !== 20) return { ok: false, code: "server_offline", message: "The server isn't running." };
    if (!this.online(player)) return { ok: false, code: "offline", message: "Player is offline. Changes can be made when they're next on." };
    const items = await this.catalogue.byId();
    const checked = checkChange(c, (id) => items.has(id) || this.catalogue.learnt.has(id), c.item ? await this.catalogue.maxStack(c.item) : null);
    if (!checked.ok) return { ok: false, code: "validation", message: checked.message };
    const ch = checked.change;
    const answer = new Promise<InvReply | null>((resolve) => {
      const t = setTimeout(() => { this.waiters = this.waiters.filter((w) => w !== listen); resolve(null); }, REPLY_MS);
      t.unref?.();
      const listen = (text: string) => {
        const r = invReply(text, player);
        if (!r) return false;
        clearTimeout(t);
        resolve(r);
        return true;
      };
      this.waiters.push(listen);
    });
    const action: ActionName = ch.op === "give" ? "inv.give" : ch.op === "clear" ? "inv.clear" : "inv.set";
    const input = ch.op === "give" ? { player, item: ch.item, count: ch.count, components: ch.components } : ch.op === "clear" ? { player, slot: ch.slot } : { player, slot: ch.slot, item: ch.item, count: ch.count, components: ch.components };
    const sent = await this.send(action, input, by);
    if (!sent.ok) return { ok: false, code: "refused", message: sent.detail ?? "The server did not take the command." };
    const r = await answer;
    const params = { op: ch.op, player, slot: ch.slot, item: ch.item, count: ch.count, components: ch.components };
    if (!r) {
      await this.audit({ userId: by, action: "inv.change", params, result: "TIMEOUT", detail: "no answer from the server" });
      return { ok: false, code: "no_answer", message: "The server did not answer. Look at the inventory again before trying once more." };
    }
    if (!r.ok) {
      if (r.maxStack && ch.item) this.catalogue.learnt.set(ch.item, r.maxStack);
      await this.audit({ userId: by, action: "inv.change", params, result: "FAILED", detail: r.message });
      return { ok: false, code: "refused", message: r.message };
    }
    await this.send("inv.notify", { player }, by);
    await this.audit({ userId: by, action: "inv.change", params, result: "OK", detail: r.what === "gave" ? `Gave ${ch.count} [${r.item}]` : `with [${r.item}]` });
    return { ok: true, reply: invPhrase(params), data: await this.live(player, by) };
  }
}
