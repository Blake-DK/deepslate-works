import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOnboardedUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { getStatus } from "@/server/status";
import { listEvents } from "@/server/event-log";
import { readFilter } from "@/lib/event-query";
import { flag, hours, lengthOf, rangeFor, series, type S } from "@/lib/analytics";
import { COUNTRIES } from "@/lib/geo-data";
import { timeAgo } from "@/lib/series";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { PlayerHead } from "@/components/server/player-head";
import { Tile } from "@/components/analytics/tile";
import { AreaChart } from "@/components/analytics/area-chart";
import { EventItem } from "@/components/events/event-list";

export const metadata: Metadata = { title: "Player" };

const TIER: Record<string, string> = { LOW: "Older PC", MID: "Decent PC", HIGH: "Gaming PC" };
const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|name:[a-z0-9_]{3,16})$/;

export default async function PlayerPage({ params }: { params: Promise<{ uuid: string }> }) {
  const viewer = await requireOnboardedUser();
  const admin = viewer.role === "ADMIN";
  const id = decodeURIComponent((await params).uuid).toLowerCase();
  if (!ID.test(id)) notFound();
  const now = new Date();
  const [member, rows, status] = await Promise.all([
    db.user.findFirst({ where: { mcUuid: id }, select: { id: true, displayName: true, pcTier: true, mcUsername: true, verifiedAt: true, guildMember: true, role: true } }),
    db.session.findMany({ where: { mcUuid: id }, orderBy: { joinedAt: "desc" }, take: 2000 }),
    getStatus(),
  ]);
  if (!member && rows.length === 0) notFound();
  const name = member?.mcUsername ?? rows[0]?.mcName ?? id.replace(/^name:/, "");
  const sessions: S[] = rows.map((r) => ({ mcUuid: r.mcUuid, mcName: r.mcName, userId: r.userId, joinedAt: r.joinedAt, leftAt: r.leftAt, country: r.country }));
  const online = Boolean(status?.online.some((p) => p.uuid === id || p.name.toLowerCase() === name.toLowerCase()));
  const total = sessions.reduce((a, s) => a + lengthOf(s, now), 0);
  const longest = sessions.reduce((a, s) => Math.max(a, lengthOf(s, now)), 0);
  const month = rangeFor("30d", now, null);
  const perDay = series(sessions, month, now).map((p) => ({ label: p.slot.label, value: Math.round(sessions.reduce((a, s) => a + Math.max(0, Math.min((s.leftAt ?? now).getTime(), p.slot.end.getTime()) - Math.max(s.joinedAt.getTime(), p.slot.start.getTime())), 0) / 60_000) }));
  const [deaths, advancements, history] = await Promise.all([
    db.event.count({ where: { kind: "DEATH", actor: id } }),
    db.event.findMany({ where: { kind: "ADVANCEMENT", actor: id }, orderBy: { at: "desc" }, take: 12, select: { id: true, at: true, meta: true, message: true } }),
    listEvents({ ...readFilter({}, admin), player: id }, admin, 40),
  ]);
  const countries = [...new Set(sessions.map((s) => s.country).filter((c): c is string => Boolean(c)))];
  const addresses = admin ? rows.filter((r) => r.ip).slice(0, 40) : [];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <PlayerHead uuid={id.startsWith("name:") ? null : id} name={name} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold"><span className="font-mono">{name}</span>{online && <Badge tone="good">Playing now</Badge>}</h1>
          <p className="text-muted-foreground">
            {member ? <>{member.displayName}{member.pcTier && <> · {TIER[member.pcTier]}</>}{member.role === "ADMIN" && <> · admin</>}</> : "Not linked to anyone in the group."}
            {countries.length > 0 && <> · {countries.map((c) => `${flag(c)} ${COUNTRIES[c]?.[0] ?? c}`).join(", ")}</>}
          </p>
          <p className="text-sm text-muted-foreground">
            {member ? (member.verifiedAt ? <>Linked in game {timeAgo(member.verifiedAt, now)}.{!member.guildMember && " No longer in the Discord server: they wait in the entrance room when they join."}</> : "Minecraft account set by an admin, not yet confirmed in game.") : "They wait in the entrance room until they link their Discord."}
          </p>
        </div>
        <Link href="/players" className={buttonClasses("secondary", "sm")}>All players</Link>
      </div>

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile label="Time played" value={hours(total)} />
        <Tile label="Sessions" value={String(sessions.length)} />
        <Tile label="Longest session" value={hours(longest)} />
        <Tile label="Deaths" value={String(deaths)} />
        <Tile label="Last on" value={online ? "now" : rows[0] ? timeAgo(rows[0].leftAt ?? rows[0].joinedAt, now) : "never"} />
      </section>

      <Card>
        <CardHeader><CardTitle>Minutes played per day</CardTitle><CardDescription>The last 30 days.</CardDescription></CardHeader>
        <CardContent><AreaChart points={perDay} unit={["minute", "minutes"]} height={120} /></CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Sessions</CardTitle><CardDescription>{rows.length > 25 ? "The latest 25." : "Every visit."}</CardDescription></CardHeader>
          <CardContent>
            {rows.length === 0 ? <p className="text-sm text-muted-foreground">Hasn&apos;t played yet.</p> : (
              <ul className="divide-y text-sm">{rows.slice(0, 25).map((r) => <li key={r.id} className="flex items-center justify-between gap-3 py-2"><span>{when.format(r.joinedAt)}</span><span className="tabular-nums text-muted-foreground">{r.leftAt ? hours(r.leftAt.getTime() - r.joinedAt.getTime()) : "on now"}</span></li>)}</ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Advancements</CardTitle><CardDescription>The latest dozen.</CardDescription></CardHeader>
          <CardContent>
            {advancements.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
              <ul className="divide-y text-sm">{advancements.map((a) => <li key={String(a.id)} className="flex items-center justify-between gap-3 py-2"><span>{(a.meta as { title?: string } | null)?.title ?? a.message}</span><span className="text-muted-foreground">{timeAgo(a.at, now)}</span></li>)}</ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>What they have been up to</CardTitle><CardDescription>{admin ? "Their latest 40 events. Open a row for the console line." : "Joins, leaves, deaths and advancements."}</CardDescription></CardHeader>
        <CardContent className="p-0">{history.rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Nothing yet.</p> : <ul className="divide-y">{history.rows.map((e) => <EventItem key={e.id} e={e} admin={admin} />)}</ul>}</CardContent>
      </Card>

      {admin && (
        <Card>
          <CardHeader><CardTitle>Addresses</CardTitle><CardDescription>Admins only. Kept for 30 days, then cleared.</CardDescription></CardHeader>
          <CardContent>
            {addresses.length === 0 ? <p className="text-sm text-muted-foreground">None on record.</p> : (
              <ul className="divide-y text-sm">{addresses.map((r) => <li key={r.id} className="flex items-center justify-between gap-3 py-2"><span className="font-mono">{r.ip}</span><span className="text-muted-foreground">{r.country ? `${flag(r.country)} ${COUNTRIES[r.country]?.[0] ?? r.country} · ` : ""}{when.format(r.joinedAt)}</span></li>)}</ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
