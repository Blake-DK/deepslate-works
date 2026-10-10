import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { designerHealth } from "@/server/designer";
import { getStatus } from "@/server/status";
import { formatDate } from "@/lib/utils";
import { formatUptime, timeAgo } from "@/lib/series";
import { KIND_LABEL, type EventKind } from "@/shared/events";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { PlayerHead } from "@/components/server/player-head";
import { AutoRefresh } from "@/components/auto-refresh";
import { PackPending } from "@/components/admin/pack-pending";
import { statusText } from "@/lib/server-status";
import type { PageQuery } from "@/components/tabs";
import { consoleLines, Flash, HealthCard, loadBackup, loadHeld, loadSchedule, loadTail, loadWatch, type Backup } from "./server/cards";
import { env } from "@/env";
import { TestServerCard } from "@/components/admin/test-server-card";
import { getMaintenance } from "@/server/settings";


export const metadata: Metadata = { title: "Admin" };

const ukClock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

/**
 * A tile of "At a glance": a link to the page that holds the controls, never a control itself. The title's link covers
 * the whole tile; a link inside it (a player's name) sits above that.
 */
function Tile({ href, title, testId, children }: { href: string; title: string; testId: string; children: React.ReactNode }) {
  return (
    <section className="relative rounded-[4px] border bg-card p-3 hover:border-primary focus-within:border-primary" data-testid={testId}>
      <h2 className="text-sm font-semibold">
        <Link href={href} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">{title} <span aria-hidden className="text-primary">→</span></Link>
      </h2>
      <div className="mt-1 space-y-1 text-sm">{children}</div>
    </section>
  );
}

/** The newest backup AMP lists, or the one asked for that it has not listed yet. */
function backupLine(b: Backup | null): React.ReactNode {
  if (!b) return <span className="text-muted-foreground">AMP does not answer about backups right now.</span>;
  if (b.job?.phase === "waiting") return <><Badge tone="warn">in progress</Badge> <span className="font-mono">{b.job.title}</span>, asked {timeAgo(new Date(b.job.requestedAt))}</>;
  const newest = (b.backups ?? []).filter((x) => x.at && !Number.isNaN(Date.parse(x.at))).sort((x, y) => Date.parse(y.at!) - Date.parse(x.at!))[0];
  if (newest) return <>Newest kept {timeAgo(new Date(newest.at!))}{newest.automatic ? ", automatic" : ""}</>;
  if (b.job?.phase === "listed" && b.job.doneAt) return <>Newest kept {timeAgo(new Date(b.job.doneAt))}</>;
  if (b.canList === false) return <span className="text-muted-foreground">The site may not list AMP&apos;s backups.</span>;
  return <span className="text-muted-foreground">AMP holds no backups yet.</span>;
}

// docs/48 A3: the admin's first page answers one question, is anything wrong and where do I go. It holds no second copy
// of a control that lives on another page. Top to bottom: the heading row, what needs attention (Maintenance among it
// while it is on: it is switched on Server, Alex 2026-10-10), the tiles, the last console lines (docs/13 §13: the console itself is on Admin → Server → Console), what admins
// did lately. The figures refresh every 30 s (router.refresh); the console streams on its own page.
export default async function AdminOverview({ searchParams }: { searchParams: PageQuery }) {
  const admin = await requireAdmin();
  const q = await searchParams;
  // docs/48 A5: a player's inventory is on their page, the Inventory tab
  if (typeof q.p === "string" && /^[0-9a-f-]{36}$/i.test(q.p)) redirect(`/players/${q.p.toLowerCase()}?tab=inventory`);
  const caller = { id: admin.id, role: "ADMIN" as const };
  const [status, tail, schedule, backup, heldNow, watch, members, invites, recent, designer, linked, maintenance] = await Promise.all([
    getStatus(),
    loadTail(caller),
    loadSchedule(caller),
    loadBackup(caller),
    loadHeld(caller),
    loadWatch(caller),
    db.user.count(),
    db.invite.count({ where: { usedBy: null, expiresAt: { gt: new Date() } } }),
    db.event.findMany({ where: { kind: { in: ["ADMIN_ACTION", "PLAYER_ACTION", "LINK", "REVOKE", "SYNC", "BACKUP"] } }, orderBy: { at: "desc" }, take: 10, select: { id: true, at: true, kind: true, message: true, meta: true } }),
    designerHealth(),
    db.user.findMany({ where: { mcUuid: { not: null } }, select: { mcUuid: true } }),
    getMaintenance(),
  ]);
  const a = statusText(status, true);
  const held = heldNow?.held ?? [];
  const heldNames = new Set(held.map((h) => h.name.toLowerCase()));
  const playing = (status.server === "online" ? status.online : []).filter((p) => !heldNames.has(p.name.toLowerCase()));
  const linkedUuids = new Set(linked.map((m) => m.mcUuid));
  const planned = schedule?.restart ?? null;
  const by = maintenance.on && maintenance.byId ? await db.user.findUnique({ where: { id: maintenance.byId }, select: { displayName: true } }) : null;
  const heldForIt = held.filter((h) => h.reason === "maintenance").map((h) => h.name);

  return (
    <div className="space-y-3">
      <AutoRefresh seconds={30} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <span className="text-sm text-muted-foreground" data-testid="admin-status">{a.line}{status.server === "online" && <> · TPS {status.tps?.toFixed(1) ?? "?"} · RAM {status.memMb ?? "?"}{status.memMaxMb ? ` / ${status.memMaxMb}` : ""} MB</>}{status.server === "unreachable" && status.reason && <> · {status.reason}</>}</span>
      </div>

      {/* what needs attention: each only when there is something to say */}
      <Flash msg={typeof q.msg === "string" ? q.msg : undefined} detail={typeof q.detail === "string" ? q.detail : undefined} />
      <HealthCard view={watch} />
      <PackPending link />
      {/* docs/48 B3: switched on Server → Power & restarts (Alex, 2026-10-10); here only a line while it is on */}
      {maintenance.on && (
        <Alert tone="warn" data-testid="maintenance-on">
          <strong>Maintenance is on</strong>{maintenance.at ? ` since ${timeAgo(maintenance.at)}` : ""}{by ? `, switched on by ${by.displayName}` : ""}. Only admins with the tick can join{heldForIt.length ? `; held for it: ${heldForIt.join(", ")}` : ""}. <Link href="/admin/server" className="underline">End it on Server → Power &amp; restarts</Link>.
        </Alert>
      )}
      {/* docs/39: a row only when the designer is set up and not well */}
      {designer && !designer.ok && (
        <p className="text-sm text-danger" data-testid="designer-problem">
          {designer.signedIn === false ? "The build designer is signed out: sign in on the VPS as its own user (no restart needed)." : `The build designer is not well: ${designer.error ?? "its CLI does not answer"}.`}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="At a glance" role="group" data-testid="at-a-glance">
        <Tile href="/admin/server" title="Server" testId="tile-server">
          <p><Badge tone={a.tone}>{a.line}</Badge></p>
          {status.server === "online" && <p className="text-muted-foreground">Up for {formatUptime(status.uptime) ?? "?"}</p>}
          {planned && <p><Badge tone="warn">Restart planned</Badge> at {ukClock(planned.at)} UK time</p>}
        </Tile>
        <Tile href="/admin/people" title={`Playing now · ${playing.length}`} testId="tile-playing">
          {playing.length === 0 ? <p className="text-muted-foreground">Nobody is playing.</p> : (
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {playing.map((p) => (
                <li key={p.uuid ?? p.name} className="flex items-center gap-1.5">
                  <PlayerHead uuid={p.uuid} name={p.name} size={20} />
                  {p.uuid ? <Link href={`/players/${p.uuid}`} className="relative z-10 font-mono underline-offset-2 hover:underline">{p.name}</Link> : <span className="font-mono">{p.name}</span>}
                  {p.uuid && !linkedUuids.has(p.uuid) && <span className="text-xs text-muted-foreground">not linked</span>}
                </li>
              ))}
            </ul>
          )}
        </Tile>
        <Tile href="/admin/joining" title="At the door" testId="tile-door">
          {heldNow === null ? <p className="text-muted-foreground">The back end did not answer.</p> : held.length === 0 ? <p className="text-muted-foreground">Nobody is waiting in the entrance room.</p> : (
            <p><Badge tone="warn">{held.length} held</Badge> <span className="font-mono">{held.map((h) => h.name).join(", ")}</span></p>
          )}
        </Tile>
        <Tile href="/admin/server?tab=backups" title="Backups" testId="tile-backups">
          <p>{backupLine(backup)}</p>
        </Tile>
        <Tile href="/admin/people" title="Members" testId="tile-members">
          <p>{members} members · {invites} open {invites === 1 ? "invite" : "invites"}</p>
        </Tile>
        {/* docs/42 §8: the test server, on the live site only, once one has been set up */}
        {!env.TEST_MODE && env.TEST_SITE_URL && <TestServerCard site={env.TEST_SITE_URL} />}
      </div>

      <section aria-label="Last console lines" className="rounded-[4px] border bg-card p-3" data-testid="console-preview">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Last 5 console lines</h2>
          <Link href="/admin/server?tab=console" className="text-sm text-primary underline">Open console</Link>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-[4px] border bg-panel p-2 font-mono text-xs leading-relaxed">{consoleLines(tail).slice(-5).map((l) => l.text).join("\n") || "(nothing yet)"}</pre>
      </section>

      <section aria-label="What admins did lately" className="rounded-[4px] border bg-card p-3" data-testid="admin-recent">
        <h2 className="text-sm font-semibold">What admins did lately</h2>
        {recent.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : (
          <ul className="divide-y text-sm">
            {recent.map((r) => {
              const meta = (r.meta ?? {}) as { result?: string };
              return (
                <li key={String(r.id)} className="py-1.5">
                  <span className="block text-xs text-muted-foreground">{formatDate(r.at)} · {KIND_LABEL[r.kind as EventKind]}</span>
                  <span className={meta.result && meta.result !== "OK" ? "text-danger" : undefined}>{r.message}</span>
                </li>
              );
            })}
          </ul>
        )}
        <Link href="/activity" className="text-xs text-primary underline">Everything, in Activity</Link>
      </section>
    </div>
  );
}
