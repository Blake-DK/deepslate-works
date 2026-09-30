"use client";
import { useState } from "react";
import { enchantLabel, itemHue, itemInitials, itemMod, itemName } from "@/lib/items";
import { cn } from "@/lib/utils";

export type Item = { slot: number; id: string; count: number; name?: string; damage?: number; enchantments?: Record<string, number>; contents?: Item[]; extra?: string[] };

const at = (items: Item[]) => new Map(items.map((i) => [i.slot, i]));

function Slot({ item, selected, hotbar, onPick, label }: { item?: Item; selected: boolean; hotbar?: boolean; onPick: (i: Item) => void; label?: string }) {
  if (!item) return <div className={cn("aspect-square rounded-sm border-2 border-border bg-muted", hotbar && "border-primary/30")} aria-label={label ? `${label}: empty` : "Empty slot"} />;
  const hue = itemHue(item.id);
  return (
    <button type="button" onClick={() => onPick(item)} title={`${item.name ?? itemName(item.id)}${item.count > 1 ? ` × ${item.count}` : ""} (${itemMod(item.id)})`} aria-label={`${label ? `${label}: ` : ""}${item.name ?? itemName(item.id)}${item.count > 1 ? `, ${item.count}` : ""}`}
      className={cn("relative grid aspect-square place-items-center rounded-sm border-2 border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", hotbar && "border-primary/30", selected && "ring-2 ring-primary")}>
      <span className="grid h-[78%] w-[78%] place-items-center rounded text-[10px] font-bold text-white [text-shadow:0_1px_1px_rgba(0,0,0,.6)] sm:text-xs" style={{ background: `hsl(${hue} 38% 42%)` }}>{itemInitials(item.id)}</span>
      {item.enchantments && <span className="pointer-events-none absolute inset-0 rounded-sm bg-gradient-to-br from-transparent via-fuchsia-400/30 to-transparent" />}
      {item.count > 1 && <span className="absolute bottom-0 right-0.5 font-mono text-[10px] font-bold text-white [text-shadow:1px_1px_0_#000] sm:text-xs">{item.count}</span>}
      {item.damage ? <span className="absolute left-1 right-1 top-0.5 h-0.5 rounded bg-danger" aria-hidden /> : null}
    </button>
  );
}

function Details({ item }: { item: Item | null }) {
  if (!item) return <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Pick a slot to see the item, the mod it comes from, its enchantments and what is inside it.</p>;
  return (
    <div className="space-y-1 rounded-lg bg-muted p-3 text-sm" data-testid="item-details">
      <p className="font-semibold">{item.name ? <>&ldquo;{item.name}&rdquo; <span className="font-normal text-muted-foreground">({itemName(item.id)})</span></> : itemName(item.id)}{item.count > 1 && <> × {item.count}</>}</p>
      <p className="font-mono text-xs text-muted-foreground">{item.id} · {itemMod(item.id)}</p>
      {item.enchantments && <p>Enchanted: {Object.entries(item.enchantments).map(([id, l]) => enchantLabel(id, l)).join(", ")}</p>}
      {item.damage ? <p>Worn: {item.damage} uses of damage</p> : null}
      {item.contents && (
        <div>
          <p className="font-medium">Inside ({item.contents.length} {item.contents.length === 1 ? "stack" : "stacks"}):</p>
          <ul className="list-disc pl-5">{item.contents.map((c, i) => <li key={i}>{c.name ?? itemName(c.id)}{c.count > 1 ? ` × ${c.count}` : ""}</li>)}</ul>
        </div>
      )}
      {item.extra?.some((e) => e.startsWith("sophisticatedcore:") || e.startsWith("sophisticatedbackpacks:")) && <p className="text-xs text-muted-foreground">A backpack keeps its contents in the world&apos;s own storage, not in the item; they are not shown here yet.</p>}
      {item.extra && <p className="text-xs text-muted-foreground">Other data on it: <span className="font-mono">{item.extra.join(", ")}</span></p>}
    </div>
  );
}

/** Inventory (27 + hotbar), armour and off-hand, and the ender chest, as the game lays them out. */
export function InventoryGrid({ inventory, ender, selectedSlot }: { inventory: Item[]; ender: Item[]; selectedSlot: number }) {
  const [picked, setPicked] = useState<Item | null>(null);
  const [tab, setTab] = useState<"inv" | "ender">("inv");
  const inv = at(inventory);
  const end = at(ender);
  const pick = (i: Item) => setPicked(i);
  const range = (a: number, b: number) => Array.from({ length: b - a }, (_, k) => a + k);
  return (
    <div className="space-y-3" data-testid="inventory">
      <div role="tablist" className="flex gap-1 border-b text-sm">
        {([["inv", `Inventory (${inventory.length})`], ["ender", `Ender chest (${ender.length})`]] as const).map(([k, l]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => { setTab(k); setPicked(null); }} className={cn("-mb-px border-b-2 px-3 py-1.5", tab === k ? "border-primary font-semibold" : "border-transparent text-muted-foreground")}>{l}</button>
        ))}
      </div>
      {tab === "inv" ? (
        <div className="flex flex-wrap items-start gap-4">
          <div className="w-full max-w-md space-y-2">
            <div className="grid grid-cols-9 gap-0.5">{range(9, 36).map((s) => <Slot key={s} item={inv.get(s)} selected={picked === inv.get(s) && !!picked} onPick={pick} />)}</div>
            <div className="grid grid-cols-9 gap-0.5">{range(0, 9).map((s) => <Slot key={s} item={inv.get(s)} hotbar selected={s === selectedSlot || (picked === inv.get(s) && !!picked)} onPick={pick} label={s === selectedSlot ? "In hand" : `Hotbar ${s + 1}`} />)}</div>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Armour · off-hand</p>
            <div className="grid w-44 grid-cols-5 gap-0.5">
              {[103, 102, 101, 100].map((s, i) => <Slot key={s} item={inv.get(s)} selected={picked === inv.get(s) && !!picked} onPick={pick} label={["Head", "Chest", "Legs", "Feet"][i]} />)}
              <Slot item={inv.get(-106)} selected={picked === inv.get(-106) && !!picked} onPick={pick} label="Off-hand" />
            </div>
          </div>
        </div>
      ) : (
        <div className="grid w-full max-w-md grid-cols-9 gap-0.5">{range(0, 27).map((s) => <Slot key={s} item={end.get(s)} selected={picked === end.get(s) && !!picked} onPick={pick} />)}</div>
      )}
      <Details item={picked} />
    </div>
  );
}
