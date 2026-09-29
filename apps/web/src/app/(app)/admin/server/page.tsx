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
import { announceAction, announcementChangeAction, backupAction, cancelRestartAction, killAction, pregenAction, runActionAction, scheduleRestartAction, serverOpAction } from "./actions";
import { mapProgress, modeText, pregenCost, progress, sleepText, type Pregen } from "@/lib/pregen";
import { ConfirmSubmit } from "@/components/server/confirm-submit";

export const metadata: Metadata = { title: "Server" };

type Players = { state: number; online: Array<{ name: string; uuid: string | null; held: boolean }>; held: Array<{ name: string; since: string }> };
type Tail = { state: number; lines: string[]; entries?: Array<{ seq: number; text: string }> };
type Schedule = { restart: { at: string; minutes: number } | null };
type Backup = { allowed: boolean; canList?: boolean; stopsServer: boolean | null; permission: string; listPermission?: string; backups?: Array<{ id: string | null; name: string; at: string | null; sizeBytes: number | null; sticky: boolean; automatic: boolean }> };

const MSG: Record<string, string> = {
  pregenOn: "Pre-generation is on.", pregenPaused: "Pre-generation stopped; where it got to is kept.", pregenOff: "The area is called off.", killed: "The server's process has been ended.",
  start: "Start sent to AMP.", stop: "Stop sent to AMP.", restart: "Restart sent to AMP.", action: "Done:", confirm: "Tick the confirmation box first.",
  error: "That didn't work:", scheduled: "Restart planned in", cancelled: "The planned restart is called off.", backup: "Backup started in AMP.", announced: "Announcement posted",
};

export default async function ServerAdminPage({ searchParams }: { searchParams: Promise<{ msg?: string; detail?: string }> }) {
  const admin = await requireAdmin();
  const { msg, detail } = await searchParams;
  const caller = { id: admin.id, role: "ADMIN" as const };
  const [status, players, tail, schedule, backup, news, pregen] = await Promise.all([
    getStatus(),
    apiFetch<Players>("/players", { caller }).catch(() => null),
    apiFetch<Tail>("/console/tail?lines=200", { caller }).catch(() => null),
    apiFetch<Schedule>("/server/schedule", { caller }).catch(() => null),
    apiFetch<Backup>("/server/backup", { caller }).catch(() => null),
    getAnnouncements(10),
    apiFetch<Pregen>("/pregen", { caller }).catch(() => null),
  ]);
  const mode = modeText(pregen);
  const prog = progress(pregen);
  const mapProg = mapProgress(pregen);
  // the map alone: chunky is not part of it and has nothing to say
  const renderOnly = pregen?.plan.mode !== undefined && pregen.plan.mode !== "off" && pregen.plan.what === "render";
  const sleepy = sleepText(pregen);
  const stuck = status?.stateCode === 45;
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
          {stuck && (
            <form action={killAction} className="space-y-2 rounded-lg border border-danger/40 bg-danger/10 p-3" data-testid="kill">
              <p className="text-sm">The server is stopping. That takes a minute at most; if it has been like this for several minutes it is stuck, and the only way out is to end its process. <strong>Whatever it had not saved is lost.</strong></p>
              <ConfirmSubmit question="End the server's process? Whatever it had not saved is lost. Only do this when the server has been stuck in Stopping for several minutes.">End the process</ConfirmSubmit>
            </form>
          )}
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
          <CardContent className="space-y-3">
            <form action={backupAction} className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sure" className="h-4 w-4" disabled={!backup?.allowed} /> I&apos;m sure</label>
              <Button type="submit" size="sm" variant="secondary" disabled={!backup?.allowed}>Back up</Button>
            </form>
            {backup?.canList ? (
              backup.backups?.length ? (
                <ul className="divide-y text-sm" aria-label="Backups AMP holds">
                  {backup.backups.slice(0, 8).map((b, i) => (
                    <li key={b.id ?? i} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                      <span className="min-w-0 truncate">{b.name}{b.sticky && <Badge className="ml-2">kept</Badge>}{b.automatic && <span className="ml-2 text-xs text-muted-foreground">automatic</span>}</span>
                      <span className="text-xs text-muted-foreground">{b.at && !Number.isNaN(Date.parse(b.at)) ? timeAgo(new Date(b.at)) : ""}{b.sizeBytes ? ` · ${(b.sizeBytes / 1048576).toFixed(0)} MB` : ""}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">AMP holds no backups yet.</p>
            ) : backup ? <p className="text-xs text-muted-foreground">To list the backups here as well, the AMP user needs <span className="font-mono">{backup.listPermission ?? "LocalFileBackup.Backup.ViewBackupsList"}</span>.</p> : null}
            <p className="text-xs text-muted-foreground">Restoring and deleting backups is done in AMP. The site cannot do either.</p>
          </CardContent>
        </Card>
        <Card data-testid="pregen">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">Pre-generation <Badge tone={mode.tone}>{mode.label}</Badge></CardTitle>
            <CardDescription>Makes the world around spawn ahead of time and renders the map of it, so that exploring is smooth and the map is whole. <strong className="text-foreground">Off unless you turn it on here.</strong></CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm" data-testid="pregen-mode">{mode.line}</p>
            <div data-testid="pregen-progress">
              <p className="text-sm">{pregen?.plan.area ? <>Radius {pregen.plan.area.radius} around {pregen.plan.area.x}, {pregen.plan.area.z}. </> : null}{renderOnly ? null : prog.line}</p>
              {!renderOnly && prog.percent !== null && <span className="mt-1 block h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(prog.percent)}><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, prog.percent)}%` }} /></span>}
            </div>
            {mapProg && (
              <div data-testid="pregen-map">
                <p className="text-sm">{mapProg.line}</p>
                {mapProg.percent !== null && <span className="mt-1 block h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Map render" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(mapProg.percent)}><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, mapProg.percent)}%` }} /></span>}
              </div>
            )}
            {mode.on ? (
              <div className="flex flex-wrap items-center gap-2">
                <form action={pregenAction}><input type="hidden" name="op" value="off" /><Button type="submit" size="sm" variant="secondary">Stop</Button></form>
                <form action={pregenAction}><input type="hidden" name="op" value="cancel" /><ConfirmSubmit question="Call the area off? Chunky forgets where it got to; what has been generated stays in the world.">Cancel</ConfirmSubmit></form>
                <span className="text-xs text-muted-foreground">Stop pauses and saves, and keeps where it got to. Cancel forgets the area. The map keeps what is rendered either way.</span>
              </div>
            ) : (
              <form action={pregenAction} className="space-y-3">
                <input type="hidden" name="op" value="on" />
                <input type="hidden" name="x" value={pregen?.plan.area?.x ?? 0} />
                <input type="hidden" name="z" value={pregen?.plan.area?.z ?? 0} />
                <div><Label htmlFor="pgr">Radius, blocks</Label><Input id="pgr" name="radius" type="number" min={16} max={10000} defaultValue={pregen?.plan.area?.radius ?? 1500} className="h-8 w-28 text-sm" required /></div>
                <p className="text-xs text-muted-foreground">Around {pregen?.plan.area?.x ?? 0}, {pregen?.plan.area?.z ?? 0} (spawn). Another radius calls the present area off and begins a new one; what is already made is passed over quickly. Roughly: {[1500, 3000, 5000, 10000].map((r) => { const c = pregenCost(r); return `${r} = ${c.hours < 1 ? `${Math.round(c.hours * 60)} min` : `${c.hours.toFixed(1)} h`}, ${c.gb < 1 ? c.gb.toFixed(1) : Math.round(c.gb)} GB`; }).join(" · ")}.</p>
                <fieldset className="space-y-1 text-sm">
                  <legend className="mb-1 font-medium">What</legend>
                  <label className="flex items-center gap-2"><input type="radio" name="what" value="both" defaultChecked className="h-4 w-4" />Generate, then render the map</label>
                  <label className="flex items-center gap-2"><input type="radio" name="what" value="generate" className="h-4 w-4" />Generate only</label>
                  <label className="flex items-center gap-2"><input type="radio" name="what" value="render" className="h-4 w-4" />Render the map only</label>
                  <p className="text-xs text-muted-foreground">The map is BlueMap&apos;s, of the overworld, inside the radius. The server is kept awake until BlueMap says the map is up to date.</p>
                </fieldset>
                <fieldset className="space-y-2">
                  <legend className="sr-only">Mode</legend>
                  <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                    <input type="radio" name="mode" value="empty" defaultChecked className="mt-1 h-4 w-4" />
                    <span className="space-y-2">
                      <span className="block font-medium">When nobody&apos;s online</span>
                      <span className="block text-muted-foreground">Carries on whenever the server is empty and pauses as soon as anyone joins.</span>
                      <span className="flex flex-wrap items-end gap-2">
                        <span><Label htmlFor="pgf">Only from</Label><Input id="pgf" name="from" type="time" className="h-8 w-28 text-sm" /></span>
                        <span><Label htmlFor="pgt">to (UK time)</Label><Input id="pgt" name="to" type="time" className="h-8 w-28 text-sm" /></span>
                        <span><Label htmlFor="pghe">Hours at most</Label><Input id="pghe" name="hoursEmpty" type="number" min={0.25} max={240} step={0.25} placeholder="no limit" className="h-8 w-28 text-sm" /></span>
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                    <input type="radio" name="mode" value="now" className="mt-1 h-4 w-4" />
                    <span className="space-y-2">
                      <span className="block font-medium">Now</span>
                      <span className="block text-danger">Runs whoever is playing. It will lag anyone who is on. The map render waits while the server is slow for them; the generating does not.</span>
                      <span className="block"><Label htmlFor="pghn">For how many hours</Label><Input id="pghn" name="hoursNow" type="number" min={0.25} max={240} step={0.25} placeholder="until 100%" className="h-8 w-28 text-sm" /></span>
                    </span>
                  </label>
                </fieldset>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" size="sm" disabled={!sleepy.ok}>Turn on</Button>
                  <ConfirmSubmit name="purge" value="1" disabled={!sleepy.ok} question="Delete the map and render it again? Every tile of the map is removed (overworld, Nether and End) and BlueMap renders the world as it is now, which takes about an hour with the server awake. The world itself is not touched. With &quot;Generate only&quot; chosen, only the map is done.">Delete the map and render it again</ConfirmSubmit>
                </div>
                <p className="text-xs text-muted-foreground">Delete the map and render it again: for a map that shows old or broken tiles. It uses the mode chosen above (when nobody&apos;s online, or now).</p>
              </form>
            )}
            {!mode.on && pregen?.plan.area && (
              <form action={pregenAction}><input type="hidden" name="op" value="cancel" /><ConfirmSubmit variant="secondary" question="Call the area off? Chunky forgets where it got to; what has been generated stays in the world.">Cancel the area</ConfirmSubmit></form>
            )}
            <div className={`rounded-lg border p-3 text-xs ${sleepy.ok ? "text-muted-foreground" : "border-danger/40 bg-danger/10"}`} data-testid="pregen-sleep">
              <p>{sleepy.line}</p>
              {sleepy.grant && <p className="mt-1">To allow it: in the instance&apos;s own panel, give the role of the user <span className="font-mono">webapp</span> the permission Settings → MinecraftModule → Limits → SleepMode, <span className="font-mono">{sleepy.grant}</span>. The setting is <span className="font-mono">{pregen?.sleep.node}</span>.</p>}
            </div>
            <p className="text-xs text-muted-foreground">The server is never started from here, and never ended. If it is asleep or stopped, the pre-generation carries on the next time it runs. Hours are hours of generating and rendering, not hours on the clock.</p>
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
          <CardHeader><CardTitle>Announce</CardTitle><CardDescription>Shows under News on the home page, with a picture if you add one (PNG, JPEG or WebP, 3 MB at most). Tick the box to also say it in game (first line, 200 characters).</CardDescription></CardHeader>
          <CardContent>
            <form action={announceAction} className="space-y-2">
              <Label htmlFor="body" className="sr-only">Announcement</Label>
              <textarea id="body" name="body" maxLength={600} required rows={3} className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="Server restarts at 8 for the new mods…" />
              <div><Label htmlFor="newsimage">Picture (optional)</Label><input id="newsimage" name="image" type="file" accept="image/png,image/jpeg,image/webp" className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm" /></div>
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
                  {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded picture, served by our own route */}
                  {n.image && <img src={n.image} alt="" loading="lazy" className="h-16 w-28 rounded border object-cover" />}
                  <p className="min-w-0 flex-1 whitespace-pre-line">{n.pinned && <Badge tone="warn" className="mr-2">Pinned</Badge>}{n.body}<span className="block text-xs text-muted-foreground">{n.author} · {timeAgo(n.createdAt)}</span></p>
                  <form action={announcementChangeAction} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={n.id} />
                    <input name="image" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Picture" className="w-44 text-xs file:mr-2 file:rounded file:border file:bg-muted file:px-2 file:py-1 file:text-xs" />
                    <Button type="submit" name="what" value="picture" size="sm" variant="ghost">{n.image ? "Change picture" : "Add picture"}</Button>
                    {n.image && <Button type="submit" name="what" value="nopicture" size="sm" variant="ghost">No picture</Button>}
                  </form>
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
