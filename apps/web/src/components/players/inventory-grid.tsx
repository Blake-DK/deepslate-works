"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { enchantLabel, itemHue, itemInitials, itemMod, itemName } from "@/lib/items";
import { clampCount, slotName } from "@/shared/slots";
import { cn } from "@/lib/utils";

export type Item = { slot: number; id: string; count: number; name?: string; damage?: number; enchantments?: Record<string, number>; contents?: Item[]; extra?: string[] };
export type Inv = { inventory: Item[]; ender: Item[]; selectedSlot: number };
type CatalogueItem = { id: string; name: string; mod: string; maxStack: number | null; icon: string | null };

// docs/13 §13: the admin's inventory and ender chest view, editable while the player is online. Every change goes to
// /api/admin/inventory/<name> (api: one vanilla command, the server's answer, the event log) and the grid is then drawn
// again from the player as they are now.

let catalogueCache: Promise<CatalogueItem[]> | null = null;
function loadCatalogue(): Promise<CatalogueItem[]> {
  catalogueCache ??= fetch("/api/admin/items").then((r) => (r.ok ? r.json() : { items: [] })).then((j: { items: CatalogueItem[] }) => j.items).catch(() => []);
  return catalogueCache;
}

const iconUrl = (id: string) => `/items/icon/${id.replace(":", "/")}.png`;

function Icon({ id }: { id: string }) {
  const [broken, setBroken] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // a picture that failed before the page's script ran (no icon for the item, e.g. TaCZ's guns) never fires onError here
  useEffect(() => {
    if (img.current?.complete && img.current.naturalWidth === 0) setBroken(true);
  }, [id]);
  if (broken) return <span className="grid h-[78%] w-[78%] place-items-center rounded text-[10px] font-bold text-white [text-shadow:0_1px_1px_rgba(0,0,0,.6)] sm:text-xs" style={{ background: `hsl(${itemHue(id)} 38% 42%)` }}>{itemInitials(id)}</span>;
  // eslint-disable-next-line @next/next/no-img-element -- a 16 px texture from our own route, drawn pixel for pixel
  return <img ref={img} src={iconUrl(id)} alt="" onError={() => setBroken(true)} className="h-[78%] w-[78%] object-cover object-top [image-rendering:pixelated]" />;
}

function tooltip(item: Item, names: Map<string, CatalogueItem>) {
  const c = names.get(item.id);
  const ench = item.enchantments ? ` · ${Object.entries(item.enchantments).map(([id, l]) => enchantLabel(id, l)).join(", ")}` : "";
  return `${item.name ? `"${item.name}" ` : ""}${c?.name ?? itemName(item.id)}${item.count > 1 ? ` × ${item.count}` : ""} (${c?.mod ?? itemMod(item.id)})${ench}`;
}

function Slot({ item, label, picked, hotbar, onPick, names }: { item?: Item; label: string; picked: boolean; hotbar?: boolean; onPick: () => void; names: Map<string, CatalogueItem> }) {
  return (
    <button type="button" onClick={onPick} title={item ? tooltip(item, names) : `${label}: empty`} aria-label={item ? `${label}: ${tooltip(item, names)}` : `${label}: empty`}
      className={cn("relative grid aspect-square place-items-center rounded-sm border-2 border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", hotbar && "border-primary/40", picked && "ring-2 ring-primary")}>
      {item && <Icon id={item.id} />}
      {item?.enchantments && <span className="pointer-events-none absolute inset-0 rounded-sm bg-gradient-to-br from-transparent via-fuchsia-400/30 to-transparent" />}
      {item && item.count > 1 && <span className="absolute bottom-0 right-0.5 font-mono text-[10px] font-bold text-white [text-shadow:1px_1px_0_#000] sm:text-xs">{item.count}</span>}
      {item?.damage ? <span className="absolute left-1 right-1 top-0.5 h-0.5 rounded bg-danger" aria-hidden /> : null}
    </button>
  );
}

/** Search over every item the server knows; count up to the item's stack; optional 1.21 components. */
function Picker({ title, initial, onSubmit, onCancel, busy }: { title: string; initial?: { id: string; count: number }; onSubmit: (v: { item: string; count: number; components: string }) => void; onCancel: () => void; busy: boolean }) {
  const [all, setAll] = useState<CatalogueItem[] | null>(null);
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<CatalogueItem | null>(null);
  const [count, setCount] = useState(initial?.count ?? 1);
  const [components, setComponents] = useState("");
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    void loadCatalogue().then((items) => {
      setAll(items);
      if (initial) setChosen(items.find((i) => i.id === initial.id) ?? null);
    });
  }, [initial]);
  const found = useMemo(() => {
    if (!all) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((i) => words.every((w) => i.name.toLowerCase().includes(w) || i.id.includes(w) || i.mod.toLowerCase().includes(w))).slice(0, 60);
  }, [all, q]);
  const max = chosen?.maxStack ?? 64;
  return (
    <div className="space-y-2 rounded-lg border bg-background p-3" data-testid="item-picker">
      <p className="text-sm font-semibold">{title}</p>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={all ? `Search ${all.length} items by name, id or mod` : "Loading the items…"} aria-label="Search items" className="h-9 w-full rounded-lg border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <ul className="grid max-h-56 grid-cols-1 gap-0.5 overflow-y-auto sm:grid-cols-2" role="listbox" aria-label="Items">
        {found.map((i) => (
          <li key={i.id}>
            <button type="button" role="option" aria-selected={chosen?.id === i.id} onClick={() => { setChosen(i); setCount((c) => clampCount(c, i.maxStack)); }} className={cn("flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted", chosen?.id === i.id && "bg-primary/10")}>
              <span className="grid h-6 w-6 shrink-0 place-items-center"><Icon id={i.id} /></span>
              <span className="min-w-0 flex-1 truncate">{i.name}</span>
              <span className="shrink-0 truncate text-xs text-muted-foreground">{i.mod}</span>
            </button>
          </li>
        ))}
        {all && found.length === 0 && <li className="p-2 text-sm text-muted-foreground">No item matches.</li>}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <p className="min-w-0 flex-1 truncate text-sm">{chosen ? <><strong>{chosen.name}</strong> <span className="font-mono text-xs text-muted-foreground">{chosen.id}</span></> : <span className="text-muted-foreground">Pick an item.</span>}</p>
        <label className="text-sm">Count <input type="number" min={1} max={max} value={count} onChange={(e) => setCount(clampCount(Number(e.target.value), chosen?.maxStack))} className="ml-1 h-8 w-20 rounded-lg border bg-background px-2 text-sm" /> <span className="text-xs text-muted-foreground">of {max}{chosen && chosen.maxStack == null ? "?" : ""}</span></label>
      </div>
      <button type="button" className="text-xs text-primary underline" onClick={() => setAdvanced((a) => !a)}>{advanced ? "Hide advanced" : "Advanced"}</button>
      {advanced && (
        <label className="block text-xs text-muted-foreground">Components, 1.21 syntax (the server checks them; nothing changes if it says no)
          <input value={components} onChange={(e) => setComponents(e.target.value)} placeholder='[minecraft:enchantments={levels:{"minecraft:sharpness":5}}]' className="mt-1 h-8 w-full rounded-lg border bg-background px-2 font-mono text-xs" />
        </label>
      )}
      <div className="flex gap-2">
        <button type="button" disabled={!chosen || busy} onClick={() => chosen && onSubmit({ item: chosen.id, count, components: components.trim() })} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy ? "Waiting for the server…" : "Done"}</button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm hover:bg-muted">Cancel</button>
      </div>
    </div>
  );
}

/** Inventory (27 + hotbar, armour, off-hand) and the ender chest; with `editable` (the player is on), every slot can be changed. */
export function InventoryGrid({ initial, player, uuid, editable = false }: { initial: Inv; player?: string | null; uuid?: string; editable?: boolean }) {
  const [inv, setInv] = useState<Inv>(initial);
  const [picked, setPicked] = useState<{ key: string; ender: boolean; slot: number } | null>(null);
  const [mode, setMode] = useState<"menu" | "set" | "give" | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [names, setNames] = useState<Map<string, CatalogueItem>>(new Map());
  useEffect(() => {
    if (editable) void loadCatalogue().then((items) => setNames(new Map(items.map((i) => [i.id, i]))));
  }, [editable]);

  const at = (items: Item[]) => new Map(items.map((i) => [i.slot, i]));
  const main = at(inv.inventory);
  const end = at(inv.ender);
  const itemAt = picked ? (picked.ender ? end : main).get(picked.slot) : undefined;
  const target = picked ? slotName(picked.slot, picked.ender) : null;

  async function send(body: object) {
    if (!player) return;
    setBusy(true);
    setSaid(null);
    try {
      const r = await fetch(`/api/admin/inventory/${player}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => null)) as { reply?: string; data?: Inv | null; error?: { message?: string } } | null;
      if (!r.ok) {
        setSaid({ ok: false, text: j?.error?.message ?? `Error ${r.status}` });
        return;
      }
      setSaid({ ok: true, text: `Done: ${j?.reply ?? "changed"}. They were told in chat.` });
      if (j?.data) setInv({ inventory: j.data.inventory, ender: j.data.ender, selectedSlot: j.data.selectedSlot });
      setMode(null);
      setPicked(null);
    } catch {
      setSaid({ ok: false, text: "The site could not be reached." });
    } finally {
      setBusy(false);
    }
  }

  async function readAgain() {
    if (!uuid) return;
    const r = await fetch(`/api/admin/inventory/data?uuid=${uuid}${player ? `&name=${player}` : ""}`, { cache: "no-store" }).catch(() => null);
    const j = r?.ok ? ((await r.json()) as { data: Inv }) : null;
    if (j) setInv({ inventory: j.data.inventory, ender: j.data.ender, selectedSlot: j.data.selectedSlot });
  }

  const pick = (slot: number, ender: boolean) => {
    setPicked({ key: `${ender ? "e" : "i"}${slot}`, ender, slot });
    setMode(editable ? "menu" : null);
    setSaid(null);
  };
  const range = (a: number, b: number) => Array.from({ length: b - a }, (_, k) => a + k);
  const cell = (slot: number, ender: boolean, hotbar = false) => {
    const label = slotName(slot, ender) ?? String(slot);
    return <Slot key={`${ender ? "e" : "i"}${slot}`} item={(ender ? end : main).get(slot)} label={hotbar && slot === inv.selectedSlot ? `${label} (in hand)` : label} hotbar={hotbar && slot === inv.selectedSlot} picked={picked?.key === `${ender ? "e" : "i"}${slot}`} onPick={() => pick(slot, ender)} names={names} />;
  };

  return (
    <div className="space-y-4" data-testid="inventory">
      <div className="flex flex-wrap items-start gap-6">
        <section className="w-full max-w-md space-y-2" aria-label="Inventory">
          <h3 className="text-sm font-semibold">Inventory</h3>
          <div className="grid grid-cols-9 gap-0.5">{range(9, 36).map((s) => cell(s, false))}</div>
          <div className="grid grid-cols-9 gap-0.5">{range(0, 9).map((s) => cell(s, false, true))}</div>
          <div className="flex items-center gap-3">
            <div className="grid w-44 grid-cols-5 gap-0.5">{[103, 102, 101, 100, -106].map((s) => cell(s, false))}</div>
            <span className="text-xs text-muted-foreground">Head, chest, legs, feet · off-hand</span>
          </div>
        </section>
        <section className="w-full max-w-md space-y-2" aria-label="Ender chest">
          <h3 className="text-sm font-semibold">Ender chest</h3>
          <div className="grid grid-cols-9 gap-0.5">{range(0, 27).map((s) => cell(s, true))}</div>
        </section>
      </div>

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => { setMode("give"); setPicked(null); setSaid(null); }} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Give…</button>
          <button type="button" onClick={() => void readAgain()} className="rounded-lg px-3 py-1.5 text-sm hover:bg-muted">Read again</button>
        </div>
      )}

      {picked && (
        <div className="space-y-2 rounded-lg bg-muted p-3 text-sm" data-testid="item-details">
          <p className="font-semibold"><span className="font-mono text-xs text-muted-foreground">{target}</span> {itemAt ? tooltip(itemAt, names) : "empty"}</p>
          {itemAt?.contents && <p>Inside: {itemAt.contents.map((c) => `${c.name ?? itemName(c.id)}${c.count > 1 ? ` × ${c.count}` : ""}`).join(", ")}</p>}
          {itemAt?.extra && <p className="text-xs text-muted-foreground">Other data on it: <span className="font-mono">{itemAt.extra.join(", ")}</span></p>}
          {editable && mode === "menu" && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setMode("set")} className="rounded-lg bg-background px-3 py-1.5 font-medium hover:bg-card">Set item…</button>
              {itemAt && <button type="button" disabled={busy} onClick={() => void send({ op: "clear", slot: target })} className="rounded-lg bg-background px-3 py-1.5 font-medium text-danger hover:bg-card">{busy ? "Waiting…" : "Clear slot"}</button>}
            </div>
          )}
        </div>
      )}
      {editable && mode === "set" && target && <Picker title={`Set ${target}`} initial={itemAt ? { id: itemAt.id, count: itemAt.count } : undefined} busy={busy} onCancel={() => setMode("menu")} onSubmit={(v) => void send({ op: "set", slot: target, item: v.item, count: v.count, components: v.components || undefined })} />}
      {editable && mode === "give" && <Picker title={`Give ${player}`} busy={busy} onCancel={() => setMode(null)} onSubmit={(v) => void send({ op: "give", item: v.item, count: v.count, components: v.components || undefined })} />}
      {said && <p className={cn("text-sm", said.ok ? "text-accent" : "text-danger")} role="status">{said.text}</p>}
    </div>
  );
}
