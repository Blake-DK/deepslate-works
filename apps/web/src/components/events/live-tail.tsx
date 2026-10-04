"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { EventRow } from "@/server/event-log";
import { EventItem } from "./event-list";

// docs/29 rule 6: Live is on by default and feeds the page's one list. The stream sends what EventItem needs
// (raw and meta only for admins with scope=admin), so a live row looks like any other.

type State = "connecting" | "live" | "reconnecting";
type Live = { on: boolean; state: State; rows: EventRow[]; toggle: () => void };

const LiveContext = createContext<Live>({ on: false, state: "connecting", rows: [], toggle: () => {} });

function readRow(data: string): EventRow | null {
  try {
    const e = JSON.parse(data) as Omit<EventRow, "at" | "actor" | "raw" | "meta"> & { at: string; raw?: string | null; meta?: unknown };
    return { ...e, at: new Date(e.at), actor: null, raw: e.raw ?? null, meta: e.meta ?? null };
  } catch {
    return null;
  }
}

/** New events as they are recorded, for as long as the page is open and seen. Uses the page's own filters. */
export function LiveTail({ query, after, scope, children }: { query: string; after: string; scope: "admin" | "player"; children: React.ReactNode }) {
  const [on, setOn] = useState(true);
  const [seen, setSeen] = useState(true);
  const [state, setState] = useState<State>("connecting");
  const [rows, setRows] = useState<EventRow[]>([]);
  const last = useRef(after);

  // A hidden tab holds no connection; when it is seen again it carries on from the last row it had.
  useEffect(() => {
    const look = () => setSeen(document.visibilityState !== "hidden");
    look();
    document.addEventListener("visibilitychange", look);
    return () => document.removeEventListener("visibilitychange", look);
  }, []);

  useEffect(() => {
    if (!on || !seen) return;
    setState("connecting");
    const sep = query ? "&" : "?";
    const es = new EventSource(`/api/events/stream${query}${sep}after=${last.current}&scope=${scope}`);
    es.onopen = () => setState("live");
    es.onerror = () => setState("reconnecting");
    es.onmessage = (m) => {
      const e = readRow(m.data as string);
      if (!e) return;
      if (BigInt(e.id) > BigInt(last.current)) last.current = e.id;
      setRows((r) => (r.some((x) => x.id === e.id) ? r : [e, ...r].slice(0, 200)));
    };
    return () => es.close();
  }, [on, seen, query, scope]);

  return <LiveContext.Provider value={{ on, state, rows, toggle: () => setOn((v) => !v) }}>{children}</LiveContext.Provider>;
}

/** The "Live" marker at the right of the chip row: click to pause, click again to carry on. */
export function LiveToggle() {
  const { on, state, toggle } = useContext(LiveContext);
  const title = !on ? "Paused: click to show new events again" : state === "live" ? "Live: new events appear at the top. Click to pause" : state === "connecting" ? "Connecting…" : "Reconnecting…";
  return (
    <button type="button" onClick={toggle} aria-pressed={on} title={title} className="ml-auto inline-flex items-center gap-1.5 rounded-[3px] px-2 py-px text-[13px] font-semibold text-muted-foreground hover:text-foreground">
      <span className={`inline-block h-2 w-2 rounded-full ${!on ? "bg-dim" : state === "live" ? "bg-accent" : "bg-primary"}`} aria-hidden />
      {on ? "Live" : "Paused"}
    </button>
  );
}

/** The page's one list: live rows on top, then the rows the page was rendered with. */
export function LiveList({ admin, empty, children }: { admin: boolean; empty: boolean; children: React.ReactNode }) {
  const { rows } = useContext(LiveContext);
  if (empty && rows.length === 0) return <p className="p-4 text-sm text-muted-foreground">Nothing matches.</p>;
  return (
    <ul className="divide-y" aria-live="polite">
      {rows.map((e) => <EventItem key={e.id} e={e} admin={admin} />)}
      {children}
    </ul>
  );
}
