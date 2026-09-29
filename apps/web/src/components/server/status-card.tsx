import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatUptime, tpsTone } from "@/lib/series";
import { pingTone } from "@/lib/ping";
import { AVAILABILITY_TEXT, type LiveStatus } from "@/server/status";
import { PlayerHead } from "./player-head";
import { Sparkline } from "./sparkline";

export function StatusCard({ status, series, address }: { status: LiveStatus | null; series: Array<number | null>; address: string | null }) {
  const a = AVAILABILITY_TEXT[status?.availability ?? "unknown"];
  const online = status?.availability === "online";
  const uptime = online ? formatUptime(status?.uptime) : null;
  const memPct = status?.memMb != null && status.memMaxMb ? Math.min(100, Math.round((status.memMb / status.memMaxMb) * 100)) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Server <Badge tone={a.tone} data-testid="status-pill">{a.label}</Badge>
          {online && status && <span className="text-sm font-normal text-muted-foreground">{status.online.length}{status.maxPlayers ? ` of ${status.maxPlayers}` : ""} playing</span>}
        </CardTitle>
        <CardDescription>{a.hint}{address && <> Address: <span className="font-mono text-foreground">{address}</span></>}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {online && status && (
          <>
            {status.online.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label="Players online">
                {status.online.map((p) => (
                  <li key={p.name} className="flex items-center gap-2 rounded-lg bg-muted py-1 pl-1 pr-3 text-sm">
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
                  {memPct != null && <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted" role="presentation"><span className="block h-full rounded-full bg-primary" style={{ width: `${memPct}%` }} /></span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Up for</dt>
                <dd>{uptime ?? <span className="text-muted-foreground">?</span>}</dd>
              </div>
            </dl>
          </>
        )}
        <Sparkline values={series} label="Players, last 24 h" />
      </CardContent>
    </Card>
  );
}
