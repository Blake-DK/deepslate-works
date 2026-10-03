import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatUptime, tpsTone } from "@/lib/series";
import { pingTone } from "@/lib/ping";
import type { LiveStatus } from "@/server/status";
import { statusText } from "@/lib/server-status";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { serverOpAction } from "@/app/(app)/admin/server/actions";
import { PlayerHead } from "./player-head";
import { Sparkline } from "./sparkline";

/** docs/13 §12: the server in the site's words; admins also get Start where joining can't wake it. */
export function StatusCard({ status, series, address, admin = false }: { status: LiveStatus; series: Array<number | null>; address: string | null; admin?: boolean }) {
  const a = statusText(status, admin);
  const online = status.server === "online";
  const uptime = online ? formatUptime(status.uptime) : null;
  const memPct = status.memMb != null && status.memMaxMb ? Math.min(100, Math.round((status.memMb / status.memMaxMb) * 100)) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Server <Badge tone={a.state === "waking" ? "waking" : a.tone} data-testid="status-pill">{a.label}</Badge>
        </CardTitle>
        <p className="font-semibold" data-testid="status-line">{a.line}</p>
        <CardDescription>{a.hint}{a.reason && <> {a.reason}</>}{address && !["off", "crashed", "unreachable"].includes(a.state) && <> Address: <span className="font-mono text-foreground">{address}</span></>}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {admin && (a.state === "off" || a.state === "crashed") && (
          <form action={serverOpAction.bind(null, "start")} className="flex flex-wrap items-center gap-3" data-testid="status-start">
            <input type="hidden" name="sure" value="on" />
            <input type="hidden" name="back" value="/" />
            <Button type="submit" size="sm">Start the server</Button>
            {a.state === "crashed" && <Link href="/admin/server?tab=console" className="text-sm text-primary underline">The last console lines</Link>}
          </form>
        )}
        {online && (
          <>
            {status.online.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label="Players online">
                {status.online.map((p) => (
                  <li key={p.name} className="flex items-center gap-2 rounded-[3px] border bg-card-2 py-1 pl-1 pr-3 text-sm">
                    <PlayerHead uuid={p.uuid} name={p.name} size={24} /> <span className="font-mono">{p.name}</span>
                    {p.ping !== null && <Badge tone={pingTone(p.ping)} title="Ping: how long the server takes to answer this player. Lower is better." data-testid="ping">{p.ping} ms</Badge>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nobody is on right now.</p>
            )}
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Speed</dt>
                <dd>{status.tps != null ? <Badge tone={tpsTone(status.tps)} title="Ticks per second. 20 is perfect.">{status.tps.toFixed(1)} TPS</Badge> : <span className="text-muted-foreground">no reading</span>}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Memory</dt>
                <dd>
                  {status.memMb != null ? <>{(status.memMb / 1024).toFixed(1)}{status.memMaxMb ? ` of ${(status.memMaxMb / 1024).toFixed(0)}` : ""} GB</> : <span className="text-muted-foreground">no reading</span>}
                  {memPct != null && <span className="mt-1 block h-1.5 overflow-hidden border bg-panel" role="presentation"><span className="block h-full bg-primary" style={{ width: `${memPct}%` }} /></span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Up for</dt>
                <dd>{uptime ?? <span className="text-muted-foreground">?</span>}</dd>
              </div>
            </dl>
          </>
        )}
        <div className="rounded-[4px] border bg-panel px-3 py-2"><Sparkline values={series} label="Players, last 24 h" /></div>
      </CardContent>
    </Card>
  );
}
