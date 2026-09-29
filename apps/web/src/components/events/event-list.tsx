import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PlayerHead } from "@/components/server/player-head";
import { KIND_LABEL, SEVERITY, type Severity } from "@/shared/events";
import type { EventRow } from "@/server/event-log";

const TONE: Record<Severity, "neutral" | "good" | "warn" | "bad"> = { info: "neutral", player: "good", warning: "warn", error: "bad", admin: "neutral" };
const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function EventItem({ e, admin }: { e: EventRow; admin: boolean }) {
  const severity = SEVERITY[e.kind];
  const body = (
    <div className="flex items-start gap-3">
      <div className="w-8 shrink-0 pt-0.5">{e.who?.mcName || e.who?.mcUuid ? <PlayerHead uuid={e.who.mcUuid} name={e.who.mcName} size={28} /> : <span className="block h-7 w-7 rounded-md bg-muted" aria-hidden />}</div>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <Badge tone={TONE[severity]} className={severity === "admin" ? "border border-primary/40 text-primary" : undefined}>{KIND_LABEL[e.kind]}</Badge>
          <span className="min-w-0 break-words">{e.message}</span>
          {e.count > 1 && <span className="text-xs text-muted-foreground">×{e.count}</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          <time dateTime={e.at.toISOString()}>{time.format(e.at)}</time>
          {e.who && e.who.mcUuid && <> · <Link href={`/players/${e.who.mcUuid}`} className="underline">{e.who.name}</Link></>}
          {e.who && !e.who.mcUuid && <> · {e.who.name}</>}
        </p>
      </div>
    </div>
  );
  if (!admin || (!e.raw && !e.meta)) return <li className="px-4 py-3" data-event={e.id}>{body}</li>;
  return (
    <li className="px-4 py-3" data-event={e.id}>
      <details>
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{body}</summary>
        <div className="ml-11 mt-2 space-y-2 text-xs">
          {e.raw && <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border bg-muted p-2">{e.raw}</pre>}
          {e.meta != null && <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border bg-muted p-2">{JSON.stringify(e.meta, null, 2)}</pre>}
        </div>
      </details>
    </li>
  );
}
