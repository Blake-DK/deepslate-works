"use client";
import { useEffect, useRef, useState } from "react";

type Line = { seq: number; text: string };
const KEEP = 200;

/** Read-only console, last 200 lines, updated as the server prints. Reconnects by itself. */
export function LiveConsole({ initial }: { initial: Line[] }) {
  const [lines, setLines] = useState<Line[]>(initial.slice(-KEEP));
  const [live, setLive] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLPreElement>(null);
  const last = useRef(initial.at(-1)?.seq ?? 0);

  useEffect(() => {
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

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5" aria-live="polite">
          <span className={`inline-block h-2 w-2 rounded-full ${live === "live" ? "bg-accent" : "bg-primary"}`} />
          {live === "live" ? "Live" : live === "connecting" ? "Connecting…" : "Reconnecting…"}
        </span>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="h-3.5 w-3.5" /> Follow new lines</label>
        <span>{lines.length} lines</span>
      </div>
      <pre ref={box} className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted p-3 text-xs leading-relaxed" tabIndex={0} aria-label="Server console">
        {lines.length ? lines.map((l) => l.text).join("\n") : "(nothing yet: the console is followed from the moment the site's backend started)"}
      </pre>
    </div>
  );
}
