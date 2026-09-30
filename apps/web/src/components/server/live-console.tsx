"use client";
import { useEffect, useRef, useState } from "react";

type Line = { seq: number; text: string; mine?: "sent" | "refused" };
const KEEP = 300;
const HISTORY = 50;

/**
 * The server's console, live, the last lines kept. For admins only; with `input`, a command line under it
 * (docs/13 §11): what is typed goes to the Minecraft console as it is. Up and down arrows walk the history.
 */
export function LiveConsole({ initial, input = true, height = "max-h-96", compact = false }: { initial: Array<{ seq: number; text: string }>; input?: boolean; height?: string; compact?: boolean }) {
  const [lines, setLines] = useState<Line[]>(initial.slice(-KEEP));
  const [live, setLive] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [follow, setFollow] = useState(true);
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const history = useRef<string[]>([]);
  const at = useRef(-1);
  const box = useRef<HTMLPreElement>(null);
  const last = useRef(initial.at(-1)?.seq ?? 0);
  const local = useRef(0);

  useEffect(() => {
    try {
      history.current = JSON.parse(sessionStorage.getItem("console-history") ?? "[]") as string[];
    } catch {}
    const es = new EventSource(`/api/admin/console?since=${last.current}`);
    es.onopen = () => setLive("live");
    es.onerror = () => setLive("reconnecting");
    es.onmessage = (m) => {
      const seq = Number(m.lastEventId) || last.current + 1;
      if (seq <= last.current) return;
      last.current = seq;
      setLines((l) => [...l, { seq, text: m.data as string }].slice(-KEEP));
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    if (follow) box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [lines, follow]);

  const note = (text: string, mine: Line["mine"]) => setLines((l) => [...l, { seq: -++local.current, text, mine }].slice(-KEEP));

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const typed = command.trim();
    if (!typed || busy) return;
    setBusy(true);
    history.current = [typed, ...history.current.filter((h) => h !== typed)].slice(0, HISTORY);
    try { sessionStorage.setItem("console-history", JSON.stringify(history.current)); } catch {}
    at.current = -1;
    setCommand("");
    setFollow(true);
    note(`> ${typed.replace(/^\/+/, "")}`, "sent");
    try {
      const r = await fetch("/api/admin/console/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: typed }) });
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
        note(`  not sent: ${j?.error?.message ?? `error ${r.status}`}`, "refused");
      }
    } catch {
      note("  not sent: the site could not be reached", "refused");
    } finally {
      setBusy(false);
    }
  }

  function keys(e: React.KeyboardEvent<HTMLInputElement>) {
    const h = history.current;
    if (e.key === "ArrowUp" && h.length) {
      e.preventDefault();
      at.current = Math.min(at.current + 1, h.length - 1);
      setCommand(h[at.current]!);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      at.current = Math.max(at.current - 1, -1);
      setCommand(at.current < 0 ? "" : h[at.current]!);
    }
  }

  return (
    <div className={compact ? "flex h-full min-h-0 flex-col gap-1" : "space-y-2"} data-testid="live-console">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5" aria-live="polite">
          <span className={`inline-block h-2 w-2 rounded-full ${live === "live" ? "bg-accent" : "bg-primary"}`} />
          {live === "live" ? "Live" : live === "connecting" ? "Connecting…" : "Reconnecting…"}
        </span>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="h-3.5 w-3.5" /> Follow new lines</label>
        <span>{lines.filter((l) => !l.mine).length} lines</span>
      </div>
      <pre ref={box} className={`${compact ? "min-h-0 flex-1" : height} overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted p-3 font-mono text-xs leading-relaxed`} tabIndex={0} aria-label="Server console">
        {lines.length
          ? lines.map((l) => <span key={l.seq} className={l.mine === "sent" ? "block font-semibold text-primary" : l.mine === "refused" ? "block text-danger" : "block"}>{l.text}</span>)
          : "(nothing yet: the console is followed from the moment the site's backend started)"}
      </pre>
      {input && (
        <form onSubmit={send} className="flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 font-mono text-sm focus-within:ring-2 focus-within:ring-ring" data-testid="console-input">
          <span className="text-primary" aria-hidden>&gt;</span>
          <label htmlFor="console-command" className="sr-only">Command for the Minecraft console</label>
          <input id="console-command" value={command} onChange={(e) => setCommand(e.target.value)} onKeyDown={keys} maxLength={1000} autoComplete="off" spellCheck={false} placeholder="A command for the Minecraft console, e.g. list or say hello" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" />
          <button type="submit" disabled={busy || !command.trim()} className="rounded-md px-2 py-0.5 text-xs font-sans font-medium hover:bg-muted disabled:opacity-50">Send</button>
        </form>
      )}
      {input && !compact && <p className="text-xs text-muted-foreground">Goes to the server as you type it and into the event log under your name. The Minecraft console only: no shell. ↑ ↓ for earlier commands.</p>}
    </div>
  );
}
