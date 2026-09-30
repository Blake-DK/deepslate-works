// Shared between web and api (identical file in both): the admin's inventory editor (planner, 2026-09-30, docs/13 §13).
// Vanilla slot names as `item replace entity` takes them, and what the save file / `data get entity` call them.

export const SLOT_RE = /^(hotbar\.[0-8]|inventory\.(?:[0-9]|1[0-9]|2[0-6])|armor\.(?:head|chest|legs|feet)|weapon\.offhand|enderchest\.(?:[0-9]|1[0-9]|2[0-6]))$/;
export const ITEM_RE = /^[a-z0-9_.-]{1,64}:[a-z0-9_./-]{1,128}$/;
/** 1.21 item components, as typed after the id: `[minecraft:enchantments={levels:{"minecraft:sharpness":5}}]`. The server
 * judges what is inside; here only one line, no section sign, and the brackets. */
export const COMPONENTS_RE = /^\[[^\r\n§]{1,1000}\]$/;

const ARMOR: Record<number, string> = { 100: "armor.feet", 101: "armor.legs", 102: "armor.chest", 103: "armor.head" };

/** The slot name for an item's `Slot` in the player's inventory, or in the ender chest. */
export function slotName(slot: number, ender = false): string | null {
  if (ender) return slot >= 0 && slot <= 26 ? `enderchest.${slot}` : null;
  if (slot >= 0 && slot <= 8) return `hotbar.${slot}`;
  if (slot >= 9 && slot <= 35) return `inventory.${slot - 9}`;
  if (ARMOR[slot]) return ARMOR[slot]!;
  if (slot === -106) return "weapon.offhand";
  return null;
}

/** 1 to the item's stack size (64 when the stack size is not known: the server has the last word). */
export function clampCount(n: number, maxStack: number | null | undefined): number {
  const max = maxStack && maxStack > 0 ? maxStack : 64;
  return Math.max(1, Math.min(max, Math.floor(Number.isFinite(n) ? n : 1)));
}

/** What the event log says, after the admin's name: "gave samoyedx 16 × create:andesite_alloy". */
export function invPhrase(p: { op?: unknown; player?: unknown; slot?: unknown; item?: unknown; count?: unknown }): string {
  const who = String(p.player ?? "?");
  if (p.op === "give") return `gave ${who} ${String(p.count ?? 1)} × ${String(p.item ?? "?")}`;
  if (p.op === "clear") return `cleared ${who}'s ${String(p.slot ?? "?")}`;
  return `set ${who}'s ${String(p.slot ?? "?")} to ${String(p.item ?? "?")}${Number(p.count) > 1 ? ` × ${String(p.count)}` : ""}`;
}
