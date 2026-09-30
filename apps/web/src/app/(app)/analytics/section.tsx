import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOnboardedUser } from "@/server/auth/session";
import { getSection } from "@/server/site-settings";
import { loadAnalytics } from "@/server/analytics";
import { byCountry, byPlayer, change, flag, heatmap, hours, peakConcurrent, percent, RANGES, series, sortPlayers, together, totals } from "@/lib/analytics";
import { COUNTRIES } from "@/lib/geo-data";
import { timeAgo } from "@/lib/series";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { PlayerHead } from "@/components/server/player-head";
import { Tile } from "@/components/analytics/tile";
import { AreaChart } from "@/components/analytics/area-chart";
import { WorldMap } from "@/components/analytics/world-map";
import { Heatmap } from "@/components/analytics/heatmap";
import { Badge } from "@/components/ui/badge";
import { getStatus } from "@/server/status";
import { heldAtTheDoor, pingByPlayer, tpsLow } from "@/server/ping";
import { GATE_TEXT, type BlockReason } from "@/shared/join-gate";
import { pingTone, worstPing } from "@/lib/ping";
import { tpsTone } from "@/lib/series";

const TIER: Record<string, string> = { LOW: "Older PC", MID: "Decent PC", HIGH: "Gaming PC" };
type Query = { range?: string; show?: string; view?: string; sort?: string; dir?: string };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await requireOnboardedUser("/players?tab=stats");
  const admin = user.role === "ADMIN";
  const privacy = await getSection("privacy");
  if (!admin && !privacy.analyticsForPlayers) redirect("/");
  const q = await searchParams;
  const data = await loadAnalytics(q.range);
  const { range, now, sessions, firstSeen, people } = data;
  // docs/05 "Connection"
  const [status, low, pings, held] = await Promise.all([getStatus(), tpsLow(now), pingByPlayer(range.from, range.to), heldAtTheDoor(range.from, range.to)]);
  const worst = status?.availability === "online" ? worstPing(status.online) : null;

  const t = totals(sessions, range.from, range.to, now, firstSeen);
  const p = range.prevFrom ? totals(sessions, range.prevFrom, range.from, now, firstSeen) : null;
  const peak = Math.max(data.snapshotPeak.now ?? 0, peakConcurrent(sessions, range.from, range.to, now));
  const prevPeak = range.prevFrom ? Math.max(data.snapshotPeak.prev ?? 0, peakConcurrent(sessions, range.prevFrom, range.from, now)) : null;
  const points = series(sessions, range, now);
  const showPlayers = q.show === "players";
  const players = sortPlayers(byPlayer(sessions, range.from, range.to, now), q.sort, q.dir);
  const countries = byCountry(sessions, range.from, range.to, now);
  const pairs = together(sessions, range.from, range.to, now, 8);
  const grid = heatmap(sessions, range.from, range.to, now);
  const nameOf = (uuid: string) => people.get(uuid)?.mcUsername ?? sessions.findLast((s) => s.mcUuid === uuid)?.mcName ?? "someone";
  const href = (over: Query) => {
    const next = { range: range.key, show: q.show, view: q.view, sort: q.sort, dir: q.dir, ...over };
    const sp = new URLSearchParams(Object.entries(next).filter(([k, v]) => v && !(k === "range" && v === "30d")) as Array<[string, string]>);
    const s = sp.toString();
    return s ? `/players?tab=stats&${s}` : "/players?tab=stats";
  };
  const sortLink = (key: string, label: string) => {
    const active = (q.sort ?? "time") === key;
    const dir = active && q.dir !== "asc" ? "asc" : "desc";
    return <Link href={href({ sort: key, dir })} className="underline-offset-2 hover:underline" aria-sort={active ? (q.dir === "asc" ? "ascending" : "descending") : undefined}>{label}{active ? (q.dir === "asc" ? " ▲" : " ▼") : ""}</Link>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Stats</h2>
          <p className="text-muted-foreground">Who has been playing, when, and for how long. Times are UK time.</p>
        </div>
        <nav className="flex gap-1 rounded-lg bg-muted p-1" aria-label="Period">
          {RANGES.map((r) => <Link key={r.key} href={href({ range: r.key })} aria-current={r.key === range.key ? "page" : undefined} className={`rounded-md px-3 py-1.5 text-sm ${r.key === range.key ? "bg-card font-medium shadow-sm" : "hover:bg-card"}`}>{r.label}</Link>)}
        </nav>
      </div>
      {!admin && !privacy.analyticsForPlayers ? null : t.sessions === 0 && <Alert>Nobody has played in this period yet. The numbers fill in from the first time someone joins the server.</Alert>}

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Sessions" value={String(t.sessions)} delta={change(t.sessions, p?.sessions ?? null)} />
        <Tile label="Players" value={String(t.players)} delta={change(t.players, p?.players ?? null)} />
        <Tile label="New players" value={String(t.newPlayers)} hint="first time on" delta={change(t.newPlayers, p?.newPlayers ?? null)} />
        <Tile label="Time played" value={hours(t.playMs)} delta={change(t.playMs, p?.playMs ?? null)} />
        <Tile label="Left within 2 min" value={percent(t.bounceRate)} hint="of sessions" delta={change(t.bounceRate, p?.bounceRate ?? null)} goodWhenUp={false} />
        <Tile label="Average session" value={t.avgMs === null ? "–" : hours(t.avgMs)} delta={change(t.avgMs, p?.avgMs ?? null)} />
        <Tile label="Sessions per player" value={t.perPlayer === null ? "–" : t.perPlayer.toFixed(1)} delta={change(t.perPlayer, p?.perPlayer ?? null)} />
        <Tile label="Longest session" value={hours(t.longestMs)} delta={change(t.longestMs, p?.longestMs ?? null)} />
        <Tile label="Most on at once" value={String(peak)} delta={change(peak, prevPeak)} />
        <Tile label="Server available" value={percent(data.uptime.available)} hint={data.uptime.running === null ? "not measured yet" : `running ${percent(data.uptime.running)}, asleep the rest`} delta={change(data.uptime.available, data.uptime.prevAvailable)} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{showPlayers ? "Players online" : "Sessions"}</CardTitle>
          <CardDescription>{showPlayers ? "The most people on at the same time" : "Sessions started"}, per {range.bucket}. <Link href={href({ show: showPlayers ? undefined : "players" })} className="underline">{showPlayers ? "Show sessions instead" : "Show players online instead"}</Link></CardDescription>
        </CardHeader>
        <CardContent><AreaChart points={points.map((pt) => ({ label: pt.slot.label, value: showPlayers ? pt.peak : pt.sessions }))} unit={showPlayers ? ["player", "players"] : ["session", "sessions"]} /></CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Countries</CardTitle>
            <CardDescription>
              {privacy.geo ? <>Where people connect from. <Link href={href({ view: q.view === "map" ? undefined : "map" })} className="underline">{q.view === "map" ? "Show the table" : "Show the map"}</Link></> : "Location off."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!privacy.geo ? <p className="text-sm text-muted-foreground">Location off. An admin can switch it on in Settings.</p> : countries.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No countries yet.{countries.unknown > 0 && <> {countries.unknown} {countries.unknown === 1 ? "session has" : "sessions have"} no country: the address was private or not in the database.</>}</p>
            ) : q.view === "map" ? <WorldMap rows={countries.rows} /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-2 font-normal">Country</th><th className="pb-2 text-right font-normal">Players</th><th className="pb-2 text-right font-normal">Sessions</th><th className="pb-2 text-right font-normal">Time played</th></tr></thead>
                  <tbody className="divide-y">
                    {countries.rows.map((c) => <tr key={c.code}><td className="py-2"><span aria-hidden className="mr-2">{flag(c.code)}</span>{COUNTRIES[c.code]?.[0] ?? c.code}</td><td className="py-2 text-right tabular-nums">{c.players}</td><td className="py-2 text-right tabular-nums">{c.sessions}</td><td className="py-2 text-right tabular-nums">{hours(c.playMs)}</td></tr>)}
                  </tbody>
                </table>
                {countries.unknown > 0 && <p className="mt-2 text-xs text-muted-foreground">{countries.unknown} {countries.unknown === 1 ? "session" : "sessions"} without a country.</p>}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Busiest hours</CardTitle><CardDescription>When the server is in use through the week.</CardDescription></CardHeader>
          <CardContent><Heatmap grid={grid} /></CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2" data-testid="connection">
        <Card>
          <CardHeader><CardTitle>Connection</CardTitle><CardDescription>How the server is keeping up, and the slowest line to it right now.</CardDescription></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Server speed now</dt>
                <dd>{status?.availability === "online" && status.tps != null ? <Badge tone={tpsTone(status.tps)} title="Ticks per second. 20 is perfect.">{status.tps.toFixed(1)} TPS</Badge> : <span className="text-muted-foreground">{status?.availability === "sleeping" ? "asleep" : "not running"}</span>}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Lowest, last 24 h</dt>
                <dd>{low ? <><Badge tone={tpsTone(low.tps)}>{low.tps.toFixed(1)} TPS</Badge> <span className="text-xs text-muted-foreground">{timeAgo(low.at, now)}</span></> : <span className="text-muted-foreground">not running in that time</span>}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Worst ping right now</dt>
                <dd>{worst ? <><Badge tone={pingTone(worst.ms)}>{worst.ms} ms</Badge> <span className="font-mono text-xs text-muted-foreground">{worst.name}</span></> : <span className="text-muted-foreground">{status?.availability === "online" && status.online.length > 0 ? "not measured yet" : "nobody on"}</span>}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Average ping</CardTitle><CardDescription>By player, in this period. Under 80 ms is good, over 150 is laggy.</CardDescription></CardHeader>
          <CardContent>
            {pings.length === 0 ? <p className="text-sm text-muted-foreground">Nothing measured in this period.</p> : (
              <ol className="space-y-2 text-sm">{pings.slice(0, 12).map((r) => <li key={r.key} className="flex items-center justify-between gap-3"><Link href={`/players/${encodeURIComponent(r.key)}`} className="flex items-center gap-2 font-mono hover:underline"><PlayerHead uuid={r.key.startsWith("name:") ? null : r.key} name={nameOf(r.key)} size={20} />{nameOf(r.key)}</Link><span className="flex items-center gap-2"><span className="text-xs text-muted-foreground">worst {r.worst} ms</span><Badge tone={pingTone(r.ms)}>{r.ms} ms</Badge></span></li>)}</ol>
            )}
          </CardContent>
        </Card>
      </div>

      {held.length > 0 && (
        <Card data-testid="held">
          <CardHeader><CardTitle>Held at the door</CardTitle><CardDescription>Members who joined before the server was open for them, or without pressing Play first, in this period. They wait in the entrance room.</CardDescription></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">{held.map((h) => <li key={h.reason} className="flex items-center justify-between gap-3"><span>{GATE_TEXT[h.reason as BlockReason] ?? h.reason}</span><span className="tabular-nums text-muted-foreground">{h.n} {h.n === 1 ? "time" : "times"}, {h.people} {h.people === 1 ? "person" : "people"}</span></li>)}</ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Most active players</CardTitle><CardDescription>Click a column to sort by it, a name for that player&apos;s page.</CardDescription></CardHeader>
        <CardContent>
          {players.length === 0 ? <p className="text-sm text-muted-foreground">Nobody yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th className="pb-2 font-normal">{sortLink("name", "Player")}</th><th className="pb-2 font-normal">PC</th><th className="pb-2 text-right font-normal">{sortLink("time", "Time played")}</th><th className="pb-2 text-right font-normal">{sortLink("sessions", "Sessions")}</th><th className="pb-2 text-right font-normal">{sortLink("seen", "Last on")}</th><th className="pb-2 text-right font-normal">Share</th></tr>
                </thead>
                <tbody className="divide-y">
                  {players.map((r) => {
                    const who = people.get(r.mcUuid);
                    return (
                      <tr key={r.mcUuid}>
                        <td className="py-2"><Link href={`/players/${encodeURIComponent(r.mcUuid)}`} className="flex items-center gap-2 hover:underline"><PlayerHead uuid={r.mcUuid.startsWith("name:") ? null : r.mcUuid} name={r.mcName} size={24} /><span><span className="font-mono">{r.mcName}</span>{who && <span className="block text-xs text-muted-foreground">{who.displayName}</span>}</span></Link></td>
                        <td className="py-2 text-muted-foreground">{who?.pcTier ? TIER[who.pcTier] : "–"}</td>
                        <td className="py-2 text-right tabular-nums">{hours(r.playMs)}</td>
                        <td className="py-2 text-right tabular-nums">{r.sessions}</td>
                        <td className="py-2 text-right text-muted-foreground">{r.lastSeen.getTime() >= now.getTime() - 60_000 ? "on now" : timeAgo(r.lastSeen, now)}</td>
                        <td className="py-2 text-right tabular-nums">{percent(r.share)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Who plays together</CardTitle><CardDescription>Pairs by the time both were on at once.</CardDescription></CardHeader>
          <CardContent>
            {pairs.length === 0 ? <p className="text-sm text-muted-foreground">No two people have been on at the same time in this period.</p> : (
              <ol className="space-y-2 text-sm">{pairs.map((pr) => <li key={`${pr.a}|${pr.b}`} className="flex items-center justify-between gap-3"><span className="font-mono">{nameOf(pr.a)} + {nameOf(pr.b)}</span><span className="tabular-nums text-muted-foreground">{hours(pr.minutes * 60_000)}</span></li>)}</ol>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Deaths</CardTitle><CardDescription>Most deaths in this period. No shame.</CardDescription></CardHeader>
          <CardContent>
            {data.deaths.length === 0 ? <p className="text-sm text-muted-foreground">Nobody has died. Yet.</p> : (
              <ol className="space-y-2 text-sm">{data.deaths.slice(0, 8).map((d) => <li key={d.actor} className="flex items-center justify-between gap-3"><Link href={`/players/${encodeURIComponent(d.actor)}`} className="flex items-center gap-2 font-mono hover:underline"><PlayerHead uuid={d.actor.startsWith("name:") ? null : d.actor} name={nameOf(d.actor)} size={20} />{nameOf(d.actor)}</Link><span className="tabular-nums text-muted-foreground">{d.n}</span></li>)}</ol>
            )}
          </CardContent>
        </Card>
      </div>

      {admin && (
        <Card>
          <CardHeader><CardTitle>Export</CardTitle><CardDescription>For admins: this period as spreadsheet files. The sessions file includes the addresses that are still kept.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <a href={`/api/admin/analytics/export?range=${range.key}`} className={buttonClasses("secondary", "sm")}>Sessions (CSV)</a>
            <a href={`/api/admin/events/export?from=${range.from.toISOString().slice(0, 10)}&to=${range.to.toISOString().slice(0, 10)}`} className={buttonClasses("secondary", "sm")}>Events (CSV)</a>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
