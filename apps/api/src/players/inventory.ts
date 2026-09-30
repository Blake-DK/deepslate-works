import type { Nbt } from "./nbt.js";

// What an admin sees of a player (docs/13, 2026-09-30): the saved player file, turned into plain data.
// Minecraft 1.21.1 item shape: {Slot: byte, id: "ns:name", count: int, components: {...}}; before 1.20.5 it was
// {Slot, id, Count: byte, tag: {...}}, read too so an old file does not come out empty.

export type Item = {
  slot: number;
  id: string;
  count: number;
  /** A name given in an anvil, as plain text. */
  name?: string;
  damage?: number;
  enchantments?: Record<string, number>;
  /** A shulker box's or a bundle's contents. */
  contents?: Item[];
  /** Component keys we do not show as such, for "what else is on it" (mods keep their data here). */
  extra?: string[];
};

export type PlayerData = {
  inventory: Item[];
  ender: Item[];
  selectedSlot: number;
  health: number | null;
  food: number | null;
  xpLevel: number | null;
  pos: [number, number, number] | null;
  dimension: string | null;
  gameMode: number | null;
};

type Obj = { [key: string]: Nbt };
const obj = (v: Nbt | undefined): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const num = (v: Nbt | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: Nbt | undefined): string | null => (typeof v === "string" ? v : null);
const list = (v: Nbt | undefined): Nbt[] => (Array.isArray(v) ? v : []);

const SHOWN = new Set(["minecraft:custom_name", "minecraft:damage", "minecraft:enchantments", "minecraft:container", "minecraft:bundle_contents", "minecraft:repair_cost"]);

/** A text component (JSON in 1.21.1) as the words it shows. */
export function plainText(raw: string): string {
  try {
    const v: unknown = JSON.parse(raw);
    const walk = (c: unknown): string =>
      typeof c === "string" ? c : Array.isArray(c) ? c.map(walk).join("") : c && typeof c === "object" ? `${walk((c as { text?: unknown }).text ?? "")}${walk((c as { extra?: unknown }).extra ?? "")}` : "";
    return walk(v).slice(0, 100);
  } catch {
    return raw.slice(0, 100);
  }
}

function levels(v: Nbt | undefined): Record<string, number> | undefined {
  const o = obj(v);
  const l = obj(o?.levels) ?? o; // {levels: {"minecraft:efficiency": 4}, show_in_tooltip?}
  if (!l) return undefined;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(l)) if (typeof n === "number" && k.includes(":")) out[k] = n;
  return Object.keys(out).length ? out : undefined;
}

export function toItem(v: Nbt, slotKey: "Slot" | "slot" = "Slot", depth = 0): Item | null {
  const o = obj(v);
  const id = str(o?.id);
  if (!o || !id) return null;
  const count = num(o.count) ?? num(o.Count) ?? 1;
  const item: Item = { slot: num(o[slotKey]) ?? num(o.Slot) ?? 0, id, count };
  const c = obj(o.components);
  if (c) {
    const name = str(c["minecraft:custom_name"]);
    if (name) item.name = plainText(name);
    const damage = num(c["minecraft:damage"]);
    if (damage) item.damage = damage;
    const ench = levels(c["minecraft:enchantments"]);
    if (ench) item.enchantments = ench;
    if (depth < 2) {
      // container: [{slot, item: {id, count, components}}]; bundle: [{id, count}]
      const inside = [
        ...list(c["minecraft:container"]).map((e) => { const x = obj(e); const it = x ? toItem(x.item ?? {}, "slot", depth + 1) : null; if (it && x) it.slot = num(x.slot) ?? 0; return it; }),
        ...list(c["minecraft:bundle_contents"]).map((e, i) => { const it = toItem(e, "slot", depth + 1); if (it) it.slot = i; return it; }),
      ].filter((x): x is Item => x !== null);
      if (inside.length) item.contents = inside;
    }
    const extra = Object.keys(c).filter((k) => !SHOWN.has(k)).slice(0, 20);
    if (extra.length) item.extra = extra;
  }
  const tag = obj(o.tag); // before 1.20.5
  if (tag) {
    const d = num(tag.Damage);
    if (d) item.damage = d;
    const e = list(tag.Enchantments).map(obj).filter((x): x is Obj => x !== null);
    if (e.length) item.enchantments = Object.fromEntries(e.map((x) => [str(x.id) ?? "?", num(x.lvl) ?? 1]));
  }
  return item;
}

export function toPlayerData(root: Obj): PlayerData {
  const items = (v: Nbt | undefined) => list(v).map((x) => toItem(x)).filter((x): x is Item => x !== null);
  const pos = list(root.Pos).map(num);
  return {
    inventory: items(root.Inventory),
    ender: items(root.EnderItems),
    selectedSlot: num(root.SelectedItemSlot) ?? 0,
    health: num(root.Health),
    food: num(root.foodLevel),
    xpLevel: num(root.XpLevel),
    pos: pos.length === 3 && pos.every((p) => p !== null) ? [pos[0]!, pos[1]!, pos[2]!] : null,
    dimension: str(root.Dimension),
    gameMode: num(root.playerGameType),
  };
}
