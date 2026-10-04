import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { getStatus } from "@/server/status";
import { formatDate } from "@/lib/utils";
import { timeAgo } from "@/lib/series";
import { pingTone } from "@/lib/ping";
import { KIND_LABEL, type EventKind } from "@/shared/events";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { PlayerHead } from "@/components/server/player-head";
import { InventoryPanel } from "@/components/players/inventory-panel";
import { AutoRefresh } from "@/components/auto-refresh";
import { statusText } from "@/lib/server-status";
import type { PageQuery } from "@/components/tabs";
import { BackupCard, consoleLines, Flash, HealthCard, HeldCard, loadBackup, loadHeld, loadPlayers, loadWatch, loadSchedule, loadTail, PowerCard, RestartCard } from "./server/cards";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Control Room" };

type Row = { key: string; name: string; uuid: string | null; sub: string; ping?: number | null };

// docs/13 §11 layout: the admin's home. Players on the left; on the right the last console lines (docs/13 §13: the
// console itself is on Admin → Server → Console) and whatever is picked: the server (power, planned restart, backup,
// what admins did lately) or a player (their inventory).
// With the server picked, the page's figures refresh every 30 s (router.refresh keeps what is typed in the console);
// with a player picked they do not, so the inventory is read once, or again with Refresh. The console streams by itself.
export default async function ControlRoom({ searchParams }: { searchParams: PageQuery }) {
  const admin = await requireAdmin();
  const q = await searchParams;
  const caller = { id: admin.id, role: "ADMIN" as const };
  const picked = typeof q.p === "string" && /^[0-9a-f-]{36}$/i.test(q.p) ? q.p.toLowerCase() : null;
  const [status, players, tail, members] = await Promise.all([
    getStatus(),
    loadPlayers(caller),
    loadTail(caller),
    db.user.findMany({ where: { mcUuid: { not: null } }, select: { displayName: true, mcUsername: true, mcUuid: true, lastSeenAt: true } }),
  ]);
  const online = status.server === "online" ? status.online : [];
  const held = new Set((players?.held ?? []).map((h) => h.name.toLowerCase()));
  const byUuid = new Map(members.map((m) => [m.mcUuid!, m]));
  const onlineRows: Row[] = online.filter((p) => !held.has(p.name.toLowerCase()) && p.uuid && byUuid.has(p.uuid)).map((p) => ({ key: p.uuid!, name: p.name, uuid: p.uuid, sub: byUuid.get(p.uuid!)!.displayName, ping: p.ping }));
  const roomRows: Row[] = online.filter((p) => held.has(p.name.toLowerCase())).map((p) => ({ key: `room-${p.name}`, name: p.name, uuid: p.uuid, sub: "in the entrance room" }));
  const guests: Row[] = online.filter((p) => !held.has(p.name.toLowerCase()) && !(p.uuid && byUuid.has(p.uuid))).map((p) => ({ key: `guest-${p.name}`, name: p.name, uuid: p.uuid, sub: "not linked yet" }));
  const onNow = new Set(online.map((p) => p.uuid));
  const offline: Row[] = members.filter((m) => !onNow.has(m.mcUuid)).sort((a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0)).map((m) => ({ key: m.mcUuid!, name: m.mcUsername ?? m.displayName, uuid: m.mcUuid, sub: m.lastSeenAt ? `on the site ${timeAgo(m.lastSeenAt)}` : m.displayName }));
  const who = picked ? ([...onlineRows, ...roomRows, ...guests, ...offline].find((r) => r.uuid === picked) ?? { key: picked, name: picked, uuid: picked, sub: "" }) : null;

  const group = (label: string, rows: Row[], empty?: string) => (
    <div>
      <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label} · {rows.length}</p>
      {rows.length === 0 && empty && <p className="px-2 text-xs text-muted-foreground">{empty}</p>}
      <ul>
        {rows.map((r) => (
          <li key={r.key}>
            {r.uuid ? (
              <Link href={`/admin?p=${r.uuid}`} aria-current={picked === r.uuid ? "true" : undefined} className={cn("flex items-center gap-2 rounded-[4px] px-2 py-1.5 text-sm hover:bg-muted", picked === r.uuid && "bg-card-2 text-foreground shadow-[inset_3px_0_0_var(--primary)]")}>
                <PlayerHead uuid={r.uuid} name={r.name} size={24} />
                <span className="min-w-0 flex-1"><span className="block truncate font-mono">{r.name}</span><span className="block truncate text-xs text-muted-foreground">{r.sub}</span></span>
                {r.ping != null && <Badge tone={pingTone(r.ping)}>{r.ping} ms</Badge>}
              </Link>
            ) : (
              <span className="flex items-center gap-2 px-2 py-1.5 text-sm"><PlayerHead uuid={null} name={r.name} size={24} /><span className="truncate font-mono">{r.name}</span></span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );

  let inspector: React.ReactNode;
  if (who?.uuid) {
    inspector = (
      <div className="space-y-3" data-testid="inspector-player">
        <div className="flex items-center gap-3">
          <PlayerHead uuid={who.uuid} name={who.name} size={40} />
          <div className="min-w-0 flex-1"><p className="truncate font-mono font-semibold">{who.name}</p><p className="truncate text-xs text-muted-foreground">{who.sub}</p></div>
          <Link href={`/players/${who.uuid}`} className={buttonClasses("secondary", "sm")}>Profile</Link>
        </div>
        <InventoryPanel uuid={who.uuid} name={who.name} caller={caller} fresh={q.fresh === "1"} refresh={`/admin?p=${who.uuid}&fresh=1`} />
        <Link href="/admin" className="text-sm text-primary underline">Back to the server</Link>
      </div>
    );
  } else {
    const [schedule, backup, heldNow, watch, members, invites, recent] = await Promise.all([
      loadSchedule(caller),
      loadBackup(caller),
      loadHeld(caller),
      loadWatch(caller),
      db.user.count(),
      db.invite.count({ where: { usedBy: null, expiresAt: { gt: new Date() } } }),
      db.event.findMany({ where: { kind: { in: ["ADMIN_ACTION", "PLAYER_ACTION", "LINK", "REVOKE", "SYNC", "BACKUP"] } }, orderBy: { at: "desc" }, take: 10, select: { id: true, at: true, kind: true, message: true, meta: true } }),
    ]);
    inspector = (
      <div className="space-y-3" data-testid="inspector-server">
        <HealthCard view={watch} />
        <PowerCard status={status} players={players} back="/admin" />
        <HeldCard held={heldNow?.held ?? null} back="/admin" />
        <RestartCard schedule={schedule} running={status.server === "online"} back="/admin" />
        <BackupCard backup={backup} back="/admin" list={false} />
        <p className="text-sm text-muted-foreground"><Link href="/admin/people" className="underline">{members} members</Link> · <Link href="/admin/people?tab=invites" className="underline">{invites} open {invites === 1 ? "invite" : "invites"}</Link></p>
        <div>
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
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!who && <AutoRefresh seconds={30} />}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Control Room</h1>
        <span className="text-sm text-muted-foreground" data-testid="control-status">{statusText(status, true).line}{status.server === "online" && <> · TPS {status.tps?.toFixed(1) ?? "?"} · RAM {status.memMb ?? "?"}{status.memMaxMb ? ` / ${status.memMaxMb}` : ""} MB</>}{status.server === "unreachable" && status.reason && <> · {status.reason}</>}</span>
      </div>
      <Flash msg={typeof q.msg === "string" ? q.msg : undefined} detail={typeof q.detail === "string" ? q.detail : undefined} />
      <div className="grid gap-3 xl:grid-cols-[13rem_minmax(0,1fr)]">
        <section aria-label="Players" className="rounded-[4px] border bg-card p-2 xl:max-h-[75vh] xl:overflow-y-auto">
          <Link href="/admin" aria-current={!who ? "true" : undefined} className={cn("flex items-center gap-2 rounded-[4px] px-2 py-1.5 text-sm font-medium hover:bg-muted", !who && "bg-card-2 text-foreground shadow-[inset_3px_0_0_var(--primary)]")}>
            <span className="grid h-6 w-6 place-items-center rounded bg-primary text-xs text-primary-foreground" aria-hidden>S</span> Server
          </Link>
          {group("Online", onlineRows, "Nobody is playing.")}
          {roomRows.length > 0 && group("Entrance room", roomRows)}
          {guests.length > 0 && group("Not linked yet", guests)}
          {group("Offline", offline)}
        </section>
        <div className="min-w-0 space-y-3">
          {/* docs/13 §13: the console itself (output and command line) is on Admin → Server → Console only */}
          <section aria-label="Last console lines" className="rounded-[4px] border bg-card p-3" data-testid="console-preview">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Last 5 console lines</h2>
              <Link href="/admin/server?tab=console" className="text-sm text-primary underline">Open console</Link>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-[4px] border bg-panel p-2 font-mono text-xs leading-relaxed">{consoleLines(tail).slice(-5).map((l) => l.text).join("\n") || "(nothing yet)"}</pre>
          </section>
          <section aria-label="Details" className="rounded-[4px] border bg-card p-3">{inspector}</section>
        </div>
      </div>
    </div>
  );
}
