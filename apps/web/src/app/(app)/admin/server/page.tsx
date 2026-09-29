import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/session";
import { apiFetch } from "@/server/api-client";
import { getStatus, AVAILABILITY_TEXT } from "@/server/status";
import { getAnnouncements } from "@/server/announcements";
import { formatUptime, timeAgo } from "@/lib/series";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Input, Label } from "@/components/ui/input";
import { LiveConsole } from "./live-console";
import { announceAction, announcementChangeAction, backupAction, cancelRestartAction, runActionAction, scheduleRestartAction, serverOpAction } from "./actions";

export const metadata: Metadata = { title: "Server" };

type Players = { state: number; online: Array<{ name: string; uuid: string | null; held: boolean }>; held: Array<{ name: string; since: string }> };
type Tail = { state: number; lines: string[]; entries?: Array<{ seq: number; text: string }> };
type Schedule = { restart: { at: string; minutes: number } | null };
type Backup = { allowed: boolean; stopsServer: boolean | null; permission: string };

const MSG: Record<string, string> = {
  start: "Start sent to AMP.", stop: "Stop sent to AMP.", restart: "Restart sent to AMP.", action: "Done:", confirm: "Tick the confirmation box first.",
  error: "That didn't work:", scheduled: "Restart planned in", cancelled: "The planned restart is called off.", backup: "Backup started in AMP.", announced: "Announcement posted",
};

export default async function ServerAdminPage({ searchParams }: { searchParams: Promise<{ msg?: string; detail?: string }> }) {
  const admin = await requireAdmin();
  const { msg, detail } = await searchParams;
  const caller = { id: admin.id, role: "ADMIN" as const };
  const [status, players, tail, schedule, backup, news] = await Promise.all([
    getStatus(),
    apiFetch<Players>("/players", { caller }).catch(() => null),
    apiFetch<Tail>("/console/tail?lines=200", { caller }).catch(() => null),
    apiFetch<Schedule>("/server/schedule", { caller }).catch(() => null),
    apiFetch<Backup>("/server/backup", { caller }).catch(() => null),
    getAnnouncements(10),
  ]);
  const a = AVAILABILITY_TEXT[status?.availability ?? "unknown"];
  const running = status?.availability === "online";
  const startable = status?.availability === "offline" || status?.availability === "sleeping";
  const planned = schedule?.restart ?? null;
  const initial = tail?.entries ?? (tail?.lines ?? []).map((text, i) => ({ seq: i - (tail?.lines.length ?? 0), text }));
  return (
    <div className="space-y-4">
      <AutoRefresh seconds={15} />
      <h1 className="text-2xl font-semibold">Server</h1>
      {msg && <Alert tone={msg === "error" || msg === "confirm" ? "error" : "success"}>{MSG[msg] ?? msg} {detail && <span className="font-mono">{detail}</span>}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Status <Badge tone={a.tone}>{status ? `${a.label} (${status.state})` : "backend unreachable"}</Badge></CardTitle>
          <CardDescription>
            {status ? <>{running ? <>Up for {formatUptime(status.uptime) ?? "?"} · </> : null}CPU {status.cpu ?? "?"}% · RAM {status.memMb ?? "?"}{status.memMaxMb ? ` / ${status.memMaxMb}` : ""} MB · TPS {status.tps?.toFixed(1) ?? "no reading"} · online: {players?.online.length ? players.online.map((p) => `${p.name}${p.held ? " (in the room)" : ""}`).join(", ") : "nobody"}</> : "Can't reach the site's backend (api)."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form action={serverOpAction} className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sure" className="h-4 w-4" /> I&apos;m sure</label>
            <Button type="submit" name="op" value="start" size="sm" disabled={!startable}>Start</Button>
            <Button type="submit" name="op" value="restart" size="sm" variant="secondary" disabled={!running}>Restart now</Button>
            <Button type="submit" name="op" value="stop" size="sm" variant="danger" disabled={!running}>Stop</Button>
          </form>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Restart with a warning</CardTitle>
            <CardDescription>Players are told in chat when you plan it (if it is more than five minutes away) and then every minute for the last five. If the site&apos;s backend is restarted in the meantime, the plan is dropped and nothing restarts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {planned ? (
              <form action={cancelRestartAction} className="flex flex-wrap items-center gap-3">
                <p className="text-sm"><Badge tone="warn">Planned</Badge> Restarts at {new Date(planned.at).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })} UK time.</p>
                <Button type="submit" size="sm" variant="secondary">Call it off</Button>
              </form>
            ) : (
              <form action={scheduleRestartAction} className="flex flex-wrap items-end gap-2">
                <div><Label htmlFor="minutes">In how many minutes</Label><Input id="minutes" name="minutes" type="number" min={1} max={120} defaultValue={5} className="h-8 w-24 text-sm" required /></div>
                <label className="flex items-center gap-2 pb-1.5 text-sm"><input type="checkbox" name="sure" className="h-4 w-4" /> I&apos;m sure</label>
                <Button type="submit" size="sm" disabled={!running}>Plan restart</Button>
              </form>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Backup now</CardTitle>
            <CardDescription>
              {backup === null ? "Can't ask AMP about backups right now." : backup.allowed ? <>Takes a backup with AMP&apos;s own backup tool.{backup.stopsServer ? " AMP says this stops the server while it runs." : ""}</> : <>Not switched on: the site&apos;s AMP user (<span className="font-mono">webapp</span>) isn&apos;t allowed to take backups. In AMP, give its role the permission <span className="font-mono">{backup.permission}</span>, or rely on AMP&apos;s backup schedule.</>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={backupAction} className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sure" className="h-4 w-4" disabled={!backup?.allowed} /> I&apos;m sure</label>
              <Button type="submit" size="sm" variant="secondary" disabled={!backup?.allowed}>Back up</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Wait room</CardTitle><CardDescription>Unlinked players are held in a bedrock room at LIMBO_POS with a link in chat (docs/14). Build it once per world.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <form action={runActionAction}><input type="hidden" name="action" value="limbo.build" /><Button type="submit" size="sm" variant="secondary" disabled={!running}>Build the room</Button></form>
            <form action={runActionAction} className="flex items-end gap-2">
              <input type="hidden" name="action" value="player.revoke" />
              <div><Label htmlFor="rvname">Kick + unwhitelist</Label><Input id="rvname" name="name" placeholder="Minecraft name" pattern="[A-Za-z0-9_]{3,16}" className="h-8 w-40 text-sm" required /></div>
              <Button type="submit" size="sm" variant="danger" disabled={!running}>Revoke</Button>
            </form>
            {players?.held.length ? <p className="text-sm text-muted-foreground">In the room now: {players.held.map((h) => h.name).join(", ")}</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Announce</CardTitle><CardDescription>Shows under News on the home page. Tick the box to also say it in game (first line, 200 characters).</CardDescription></CardHeader>
          <CardContent>
            <form action={announceAction} className="space-y-2">
              <Label htmlFor="body" className="sr-only">Announcement</Label>
              <textarea id="body" name="body" maxLength={600} required rows={3} className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="Server restarts at 8 for the new mods…" />
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" name="pinned" className="h-4 w-4" /> Pin to the top</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="say" className="h-4 w-4" disabled={!running} /> Also say it in game</label>
                <Button type="submit" size="sm">Post</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
      {news.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Announcements</CardTitle><CardDescription>The home page shows the pinned ones and the newest three.</CardDescription></CardHeader>
          <CardContent>
            <ul className="divide-y">
              {news.map((n) => (
                <li key={n.id} className="flex flex-wrap items-start gap-3 py-2 text-sm">
                  <p className="min-w-0 flex-1 whitespace-pre-line">{n.pinned && <Badge tone="warn" className="mr-2">Pinned</Badge>}{n.body}<span className="block text-xs text-muted-foreground">{n.author} · {timeAgo(n.createdAt)}</span></p>
                  <form action={announcementChangeAction} className="flex gap-1">
                    <input type="hidden" name="id" value={n.id} />
                    <Button type="submit" name="what" value={n.pinned ? "unpin" : "pin"} size="sm" variant="ghost">{n.pinned ? "Unpin" : "Pin"}</Button>
                    <Button type="submit" name="what" value="delete" size="sm" variant="ghost" className="text-danger">Delete</Button>
                  </form>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Console</CardTitle><CardDescription>Read-only, the last 200 lines, live. Players never see this.</CardDescription></CardHeader>
        <CardContent><LiveConsole initial={initial} /></CardContent>
      </Card>
    </div>
  );
}
