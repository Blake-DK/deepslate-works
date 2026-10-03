"use client";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Check } from "@/components/ui/check";

type Live = { id: string; at: string; kind: string; label: string; tone: "neutral" | "good" | "warn" | "bad"; message: string; count: number };

const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** New events as they are recorded, newest on top, for as long as the page is open. Uses the page's own filters. */
export function LiveTail({ query, after, scope }: { query: string; after: string; scope: "admin" | "player" }) {
  const [on, setOn] = useState(false);
  const [state, setState] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [rows, setRows] = useState<Live[]>([]);

  useEffect(() => {
    if (!on) return;
    const sep = query ? "&" : "?";
    const es = new EventSource(`/api/events/stream${query}${sep}after=${after}&scope=${scope}`);
    es.onopen = () => setState("live");
    es.onerror = () => setState("reconnecting");
    es.onmessage = (m) => {
      try {
        const e = JSON.parse(m.data as string) as Live;
        setRows((r) => (r.some((x) => x.id === e.id) ? r : [e, ...r].slice(0, 200)));
      } catch {}
    };
    return () => es.close();
  }, [on, query, after, scope]);

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <Check type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); setState("connecting"); }} /> Live: show new events as they happen
        {on && <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className={`inline-block h-2 w-2 rounded-full ${state === "live" ? "bg-accent" : "bg-primary"}`} />{state === "live" ? "watching" : state === "connecting" ? "connecting…" : "reconnecting…"}</span>}
      </label>
      {on && (
        <ul className="divide-y rounded-[4px] border bg-card" aria-live="polite">
          {rows.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">Nothing new yet.</li>}
          {rows.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2 text-sm">
              <span className="text-xs text-muted-foreground">{time.format(new Date(e.at))}</span>
              <Badge tone={e.tone}>{e.label}</Badge>
              <span className="min-w-0 break-words">{e.message}</span>
              {e.count > 1 && <span className="text-xs text-muted-foreground">×{e.count}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
