import Link from "next/link";
import { apiFetch, ApiError } from "@/server/api-client";
import { DIMENSION, GAME_MODE } from "@/lib/items";
import { timeAgo } from "@/lib/series";
import { buttonClasses } from "@/components/ui/button";
import { InventoryGrid, type Item } from "./inventory-grid";

type Data = { data: { inventory: Item[]; ender: Item[]; selectedSlot: number; health: number | null; food: number | null; xpLevel: number | null; pos: [number, number, number] | null; dimension: string | null; gameMode: number | null }; savedAt: string | null; fresh: boolean; running: boolean; live?: boolean };

/**
 * A player's inventory, ender chest and state, for admins (docs/13 §11, §13). A player who is on is read as they are
 * now (`data get entity`) and can be changed; anyone else is shown from the game's save of them, read only.
 * `refresh` is this page's own address with fresh=1 (the game saves first).
 */
export async function InventoryPanel({ uuid, name, caller, fresh, refresh }: { uuid: string; name?: string | null; caller: { id: string; role: "ADMIN" }; fresh: boolean; refresh: string }) {
  let r: Data | null = null;
  let problem: string | null = null;
  const query = new URLSearchParams();
  if (fresh) query.set("fresh", "1");
  if (name) { query.set("live", "1"); query.set("name", name); }
  try {
    r = await apiFetch<Data>(`/players/${encodeURIComponent(uuid)}/data${query.size ? `?${query}` : ""}`, { caller, timeoutMs: 20_000 });
  } catch (e) {
    problem = e instanceof ApiError ? (e.status === 404 ? "The server has no saved data for this player yet. It appears after their first time on." : e.message) : "The site's backend did not answer.";
  }
  if (!r) return <p className="text-sm text-muted-foreground" data-testid="inventory-problem">{problem}</p>;
  const d = r.data;
  const live = Boolean(r.live);
  const saved = r.savedAt && !Number.isNaN(Date.parse(r.savedAt)) ? new Date(r.savedAt) : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {live ? <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">Live</span> : <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">From the save file</span>}
        {d.health !== null && <span>Health <strong>{Math.round(d.health * 10) / 10}</strong>/20</span>}
        {d.food !== null && <span>Food <strong>{d.food}</strong>/20</span>}
        {d.xpLevel !== null && <span>XP level <strong>{d.xpLevel}</strong></span>}
        {d.gameMode !== null && <span>{GAME_MODE[d.gameMode] ?? `Mode ${d.gameMode}`}</span>}
        {d.pos && <span className="font-mono text-xs">{DIMENSION[d.dimension ?? ""] ?? d.dimension ?? ""} {d.pos.map((p) => Math.floor(p)).join(" ")}</span>}
      </div>
      {!live && <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground" data-testid="inventory-offline">Player is offline. Changes can be made when they&apos;re next on.</p>}
      <InventoryGrid initial={{ inventory: d.inventory, ender: d.ender, selectedSlot: d.selectedSlot }} player={name} uuid={uuid} editable={live} />
      {!live && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{r.fresh ? "Saved by the game just now." : saved ? `As the game last saved it, ${timeAgo(saved)}.` : "As the game last saved it."}{!r.fresh && r.running ? " The game saves every few minutes and when a player leaves." : ""}</span>
          {r.running && <Link href={refresh} className={buttonClasses("secondary", "sm")} prefetch={false}>Refresh</Link>}
        </p>
      )}
    </div>
  );
}
