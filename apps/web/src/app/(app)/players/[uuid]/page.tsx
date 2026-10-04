import { getSection } from "@/server/site-settings";
import type { Metadata } from "next";
import { getExtraNames } from "@/server/modpack/lock";
import { extrasLine, extrasReportSchema } from "@/lib/extras-line";
import { Prisma } from "@prisma/client";
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
import { suggestTier, summary, type SystemInfo } from "@/lib/install-report";
import { pingReadings, sessionPings } from "@/server/ping";
import { average, pingSlots, pingTone } from "@/lib/ping";
import { Sparkline } from "@/components/server/sparkline";
import { pickTab, tabHref, type PageQuery } from "@/components/tabs";
import { InventoryPanel } from "@/components/players/inventory-panel";
import { MemberMenu } from "../../admin/users/member-menu";
import { setEarlyAccessAction } from "../../admin/users/actions";
import { Switch } from "@/components/admin/parts";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/server/api-client";
import { stripLink } from "@/components/strip-link";

type PartyView = { id: string; name: string | null; members: Array<{ uuid: string; name: string; rank: string; owner: boolean }>; allies: Array<{ id: string; name: string | null; owner: string | null }> };
const RANK: Record<string, string> = { ADMIN: "admin", MODERATOR: "moderator" };

export const metadata: Metadata = { title: "Player" };

const TIER: Record<string, string> = { LOW: "Older PC", MID: "Decent PC", HIGH: "Gaming PC" };
const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|name:[a-z0-9_]{3,16})$/;

// docs/13 §11 layout: the header and the totals, then tabs. Everyone: Overview, Sessions, Activity. Admins also:
// Inventory (from the game's save of the player) and PC & access (last install, addresses, the member's menu).
export default async function PlayerPage({ params, searchParams }: { params: Promise<{ uuid: string }>; searchParams: PageQuery }) {
  const viewer = await requireOnboardedUser();
  const admin = viewer.role === "ADMIN";
  const id = decodeURIComponent((await params).uuid).toLowerCase();
  if (!ID.test(id)) notFound();
  const now = new Date();
  const [member, rows, status] = await Promise.all([
    db.user.findFirst({ where: { mcUuid: id }, select: { id: true, displayName: true, pcTier: true, pcTierSource: true, mcUsername: true, verifiedAt: true, guildMember: true, outsideAuth: true, discordId: true, role: true, earlyAccess: true } }),
    db.session.findMany({ where: { mcUuid: id }, orderBy: { joinedAt: "desc" }, take: 2000 }),
    getStatus(),
  ]);
  if (!member && rows.length === 0) notFound();
  const name = member?.mcUsername ?? rows[0]?.mcName ?? id.replace(/^name:/, "");
  const sessions: S[] = rows.map((r) => ({ mcUuid: r.mcUuid, mcName: r.mcName, userId: r.userId, joinedAt: r.joinedAt, leftAt: r.leftAt, country: r.country }));
  const here = status?.online.find((p) => p.uuid === id || p.name.toLowerCase() === name.toLowerCase()) ?? null;
  const online = Boolean(here);
  // docs/05 "Connection": the session in hand as a line, and the average of each of the latest sessions
  const current = rows.find((r) => r.leftAt === null) ?? null;
  const [readings, perSession] = await Promise.all([
    online && current ? pingReadings(id, current.joinedAt, now) : Promise.resolve([]),
    sessionPings(id, rows.slice(0, 25).map((r) => r.id)),
  ]);
  const pingLine = online && current ? pingSlots(readings, current.joinedAt, now, Math.min(60, Math.max(12, readings.length))) : [];
  const pingNow = here?.ping ?? null;
  const pingAvg = average(readings.map((r) => r.ms));
  const total = sessions.reduce((a, s) => a + lengthOf(s, now), 0);
  const longest = sessions.reduce((a, s) => Math.max(a, lengthOf(s, now)), 0);
  const month = rangeFor("30d", now, null);
  const perDay = series(sessions, month, now).map((p) => ({ label: p.slot.label, value: Math.round(sessions.reduce((a, s) => a + Math.max(0, Math.min((s.leftAt ?? now).getTime(), p.slot.end.getTime()) - Math.max(s.joinedAt.getTime(), p.slot.start.getTime())), 0) / 60_000) }));
  const [deaths, advancements, history] = await Promise.all([
    db.event.count({ where: { kind: "DEATH", actor: id } }),
    db.event.findMany({ where: { kind: "ADVANCEMENT", actor: id }, orderBy: { at: "desc" }, take: 12, select: { id: true, at: true, meta: true, message: true } }),
    listEvents({ ...readFilter({}, admin), player: id }, admin, 40),
  ]);
  // Admins only: what the installer last reported from this member's PC (docs/07 "Install reports").
  const install = admin && member ? await db.installReport.findFirst({ where: { userId: member.id }, orderBy: { at: "desc" }, select: { id: true, at: true, outcome: true, failedStep: true, packVersion: true, system: true } }) : null;
  // 2.0.1: their Extras tab, from the latest report that says
  const extrasRun = admin && member ? await db.installReport.findFirst({ where: { userId: member.id, extras: { not: Prisma.DbNull } }, orderBy: { at: "desc" }, select: { extras: true } }) : null;
  const extrasText = extrasRun ? extrasLine(extrasReportSchema.safeParse(extrasRun.extras).data ?? null, await getExtraNames()) : null;
  const pc = install ? summary(install.system as SystemInfo) : null;
  const guess = install ? suggestTier(install.system as SystemInfo) : null;
  // docs/31 B-36: "Players can see the Stats tab" off means a member does not see where and when another member
  // played here either. Admins always do; a member always sees their own.
  const stats = admin || member?.id === viewer.id || (await getSection("privacy")).analyticsForPlayers;
  const countries = stats ? [...new Set(sessions.map((s) => s.country).filter((c): c is string => Boolean(c)))] : [];
  const addresses = admin ? rows.filter((r) => r.ip).slice(0, 40) : [];
  const tabs = [
    { key: "overview", label: "Overview" },
    ...(stats ? [{ key: "sessions", label: "Sessions", count: rows.length || null }] : []),
    { key: "activity", label: "Activity" },
    ...(admin && !id.startsWith("name:") ? [{ key: "inventory", label: "Inventory" }] : []),
    ...(admin ? [{ key: "pc", label: "PC & access" }] : []),
  ];
  const q = await searchParams;
  const tab = pickTab(q.tab, tabs);
  // Open Parties and Claims, read from its files on the server (undefined: the server could not be asked)
  const party = tab === "overview" && !id.startsWith("name:")
    ? await apiFetch<{ party: PartyView | null }>(`/players/${encodeURIComponent(id)}/party`, { timeoutMs: 8000 }).then((r) => r.party).catch(() => undefined)
    : undefined;
  const base = `/players/${encodeURIComponent(id)}`;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <PlayerHead uuid={id.startsWith("name:") ? null : id} name={name} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold"><span className="font-mono">{name}</span>{online && <Badge tone="good">Playing now</Badge>}</h1>
          <p className="text-muted-foreground">
            {member ? <>{member.displayName}{member.pcTier && <> · {TIER[member.pcTier]}{member.pcTierSource === "measured" ? " (measured)" : " (their own pick)"}</>}{member.role === "ADMIN" && <> · admin</>}</> : "Not linked to anyone in the group."}
            {countries.length > 0 && <> · {countries.map((c) => `${flag(c)} ${COUNTRIES[c]?.[0] ?? c}`).join(", ")}</>}
          </p>
          <p className="text-sm text-muted-foreground">
            {member ? (member.verifiedAt ? <>Linked in game {timeAgo(member.verifiedAt, now)}.{member.outsideAuth ? " Came in by an invite: they don't have to be in the Discord server." : !member.guildMember && " No longer in the Discord server: they wait in the entrance room when they join."}</> : "Minecraft account set by an admin, not yet confirmed in game.") : "They wait in the entrance room until they link their Discord."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {admin && member && (
            <>
              <Switch action={setEarlyAccessAction} fields={{ id: member.id, on: member.earlyAccess ? "0" : "1" }} on={member.earlyAccess} label={`Early access for ${member.displayName}`} disabled={member.role === "ADMIN"} why={member.role === "ADMIN" ? "Admins don't need it" : "Early access: plays before the site is live"} />
              <MemberMenu u={member} meId={viewer.id} />
            </>
          )}
          <Link href="/players" className={buttonClasses("secondary", "sm")}>All players</Link>
        </div>
      </div>

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile label="Time played" value={hours(total)} />
        <Tile label="Sessions" value={String(sessions.length)} />
        <Tile label="Longest session" value={hours(longest)} />
        <Tile label="Deaths" value={String(deaths)} />
        <Tile label="Last on" value={online ? "now" : rows[0] ? timeAgo(rows[0].leftAt ?? rows[0].joinedAt, now) : "never"} />
      </section>

      <nav aria-label="About this player" className="flex overflow-x-auto whitespace-nowrap border-b" data-testid="tabs">
        {tabs.map((t) => (
          <Link key={t.key} href={tabHref(base, tabs, t.key)} aria-current={t.key === tab ? "page" : undefined} className={cn("-mb-px", stripLink(t.key === tab))}>
            {t.label}{t.count != null && <span className="text-xs font-normal text-dim">{t.count}</span>}
          </Link>
        ))}
      </nav>

      {tab === "overview" && online && (
        <Card data-testid="connection">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">Connection {pingNow !== null && <Badge tone={pingTone(pingNow)}>{pingNow} ms</Badge>}</CardTitle>
            <CardDescription>Their ping through this session{pingAvg !== null ? <>, {pingAvg} ms on average</> : null}. Measured every 15 seconds; lower is better.</CardDescription>
          </CardHeader>
          <CardContent>
            {readings.length < 2 ? <p className="text-sm text-muted-foreground">Not measured yet. The line appears after a few minutes on the server.</p> : <Sparkline values={pingLine} label="Ping, this session" unit={["ms", "ms"]} />}
          </CardContent>
        </Card>
      )}

      {tab === "overview" && !id.startsWith("name:") && (
        <Card data-testid="party">
          <CardHeader>
            <CardTitle>Party</CardTitle>
            <CardDescription>Party members see each other on the minimap and world map. Parties are made in the game: press &apos; (apostrophe).</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {party === undefined ? <p className="text-muted-foreground">Can&apos;t read the parties from the server right now.</p> : party === null ? <p className="text-muted-foreground">Not in a party.</p> : (
              <div className="space-y-2">
                {party.name && <p className="font-medium" data-testid="party-name">{party.name}</p>}
                <ul className="flex flex-wrap gap-2" aria-label="Party members">
                  {party.members.map((m) => (
                    <li key={m.uuid}>
                      <Link href={`/players/${m.uuid}`} className="inline-flex items-center gap-1.5 rounded-[3px] border bg-card-2 px-2 py-0.5 hover:text-foreground">
                        <PlayerHead uuid={m.uuid} name={m.name} size={16} />
                        <span className="font-mono">{m.name || m.uuid.slice(0, 8)}</span>
                        {m.owner ? <Badge>leader</Badge> : RANK[m.rank] ? <span className="text-xs text-muted-foreground">{RANK[m.rank]}</span> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
                {party.allies.length > 0 && <p className="text-muted-foreground">Allied with {party.allies.map((a) => a.name ?? (a.owner ? `${a.owner}'s party` : "a party")).join(", ")}.</p>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "overview" && (
        <Card>
          <CardHeader><CardTitle>Minutes played per day</CardTitle><CardDescription>The last 30 days.</CardDescription></CardHeader>
          <CardContent><AreaChart points={perDay} unit={["minute", "minutes"]} height={120} /></CardContent>
        </Card>
      )}

      {tab === "sessions" && (
        <Card>
          <CardHeader><CardTitle>Sessions</CardTitle><CardDescription>{rows.length > 25 ? "The latest 25." : "Every visit."} With the average ping where it was measured.</CardDescription></CardHeader>
          <CardContent>
            {rows.length === 0 ? <p className="text-sm text-muted-foreground">Hasn&apos;t played yet.</p> : (
              <ul className="divide-y text-sm">{rows.slice(0, 25).map((r) => <li key={r.id} className="flex items-center justify-between gap-3 py-2"><span>{when.format(r.joinedAt)}</span><span className="tabular-nums text-muted-foreground">{perSession.has(r.id) && <span className="mr-3" title="Average ping in this session">{perSession.get(r.id)} ms</span>}{r.leftAt ? hours(r.leftAt.getTime() - r.joinedAt.getTime()) : "on now"}</span></li>)}</ul>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "overview" && (
        <Card>
          <CardHeader><CardTitle>Advancements</CardTitle><CardDescription>The latest dozen.</CardDescription></CardHeader>
          <CardContent>
            {advancements.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
              <ul className="divide-y text-sm">{advancements.map((a) => <li key={String(a.id)} className="flex items-center justify-between gap-3 py-2"><span>{(a.meta as { title?: string } | null)?.title ?? a.message}</span><span className="text-muted-foreground">{timeAgo(a.at, now)}</span></li>)}</ul>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "activity" && (
      <Card>
        <CardHeader><CardTitle>What they have been up to</CardTitle><CardDescription>{admin ? "Their latest 40 events. Open a row for the console line." : "Joins, leaves, deaths and advancements."}</CardDescription></CardHeader>
        <CardContent className="p-0">{history.rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Nothing yet.</p> : <ul className="divide-y">{history.rows.map((e) => <EventItem key={e.id} e={e} admin={admin} />)}</ul>}</CardContent>
      </Card>
      )}

      {tab === "inventory" && admin && (
        <Card>
          <CardHeader><CardTitle>Inventory</CardTitle><CardDescription>Admins only. Inventory, armour, off-hand and ender chest, health, food, XP and where they are.</CardDescription></CardHeader>
          <CardContent><InventoryPanel uuid={id} name={name} caller={{ id: viewer.id, role: "ADMIN" }} fresh={q.fresh === "1"} refresh={`${base}?tab=inventory&fresh=1`} /></CardContent>
        </Card>
      )}

      {tab === "pc" && admin && member && (
        <Card>
          <CardHeader>
            <CardTitle>Their PC and last install</CardTitle>
            <CardDescription>Admins only. From the installer&apos;s last report.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!install || !pc ? <p className="text-muted-foreground">No install report from them yet.</p> : (
              <>
                {extrasText && <p data-testid="player-extras">{extrasText}</p>}
                <p><Link href={`/admin/installs/${install.id}`} className="underline">{install.outcome === "ok" ? `Installed ${install.packVersion}` : install.outcome === "cancelled" ? "Stopped the installer" : "The installer failed"}{install.failedStep ? ` at "${install.failedStep}"` : ""}</Link> <span className="text-muted-foreground">{timeAgo(install.at, now)}</span></p>
                <p className="text-muted-foreground">{pc.os} · {pc.cpu} · {pc.ram} · {pc.gpu}</p>
                {guess ? <p>Tier, measured: <strong>{TIER[guess.tier]}</strong> <span className="text-muted-foreground">({guess.why})</span></p> : <p className="text-muted-foreground">Not enough in the report to work out the tier.</p>}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "pc" && admin && (
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
