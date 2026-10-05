import { dateToUkLocal, ukShort } from "@/lib/uk-time";
import { apiFetch } from "@/server/api-client";
import type { LiveStatus } from "@/server/status";
import { statusText } from "@/lib/server-status";
import { formatUptime, timeAgo } from "@/lib/series";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Input, Label, fieldClasses } from "@/components/ui/input";
import { HowThisWorks } from "@/components/tabs";
import { ConfirmSubmit } from "@/components/server/confirm-submit";
import { mapProgress, modeText, pregenCost, progress, sleepText, type Pregen } from "@/lib/pregen";
import type { getAnnouncements } from "@/server/announcements";
import { DistanceForm } from "@/components/server/distance-form";
import { msptTone, waiting, type Distance } from "@/lib/distance";
import { clearingText, COUNTED, countTone, LABELS, planText, type Ground } from "@/lib/ground";
import { releaseHeldAction, announceAction, announcementChangeAction, announcementDatesAction, backupAction, cancelRestartAction, distanceAction, groundClearAction, groundPlanAction, killAction, pregenAction, runActionAction, scheduleRestartAction, serverOpAction } from "./actions";
import { Check } from "@/components/ui/check";
import { cn } from "@/lib/utils";
import { GATE_TEXT, type BlockReason } from "@/shared/join-gate";

// The cards of Admin → Server and Admin → News, and the ones the Control Room shares. Everything that was on the one
// long Server page before docs/13 §11, word for word where it was a control; long explanations fold into
// "How this works".

export type Players = { state: number; online: Array<{ name: string; uuid: string | null; held: boolean }>; held: Array<{ name: string; since: string }> };
export type Tail = { state: number; lines: string[]; entries?: Array<{ seq: number; text: string }> };
export type Schedule = { restart: { at: string; minutes: number } | null };
export type BackupJob = { title: string; requestedAt: string; by: string | null; phase: "waiting" | "listed" | "failed"; checkedAt: string | null; doneAt: string | null; sizeBytes: number | null; reason: string | null };
export type Backup = { allowed: boolean; canList?: boolean; stopsServer: boolean | null; permission: string; listPermission?: string; backups?: Array<{ id: string | null; name: string; at: string | null; sizeBytes: number | null; sticky: boolean; automatic: boolean }>; job?: BackupJob | null };
type Caller = { id: string; role: "ADMIN" };

export const loadPlayers = (caller: Caller) => apiFetch<Players>("/players", { caller }).catch(() => null);
export type HeldEntry = { name: string; uuid: string | null; kind: "link" | "play" | "closed" | "old" | "mods" | "vote"; reason: string | null; since: string; member: boolean; back: boolean };
export const loadHeld = (caller: Caller) => apiFetch<{ state: number; held: HeldEntry[] }>("/held", { caller }).catch(() => null);
export type HealthCheck = { ok: boolean | null; text: string };
export type WatchView = { watch?: boolean; checks?: Record<string, HealthCheck> | null; checkedAt?: string | null };
export const loadWatch = (caller: Caller) => apiFetch<WatchView>("/health", { caller, timeoutMs: 15_000 }).catch(() => null);
export const loadTail = (caller: Caller) => apiFetch<Tail>("/console/tail?lines=200", { caller }).catch(() => null);
export const loadSchedule = (caller: Caller) => apiFetch<Schedule>("/server/schedule", { caller }).catch(() => null);
export const loadBackup = (caller: Caller) => apiFetch<Backup>("/server/backup", { caller }).catch(() => null);
export const loadDistance = (caller: Caller) => apiFetch<Distance>("/server/distance", { caller, timeoutMs: 15_000 }).catch(() => null);
export const loadGround = (caller: Caller) => apiFetch<Ground>("/server/ground", { caller, timeoutMs: 40_000 }).catch(() => null);
export const loadPregen = (caller: Caller) => apiFetch<Pregen>("/pregen", { caller }).catch(() => null);
export const consoleLines = (tail: Tail | null) => tail?.entries ?? (tail?.lines ?? []).map((text, i) => ({ seq: i - (tail?.lines.length ?? 0), text }));

const MSG: Record<string, string> = {
  pregenOn: "Pre-generation is on.", pregenPaused: "Pre-generation stopped; where it got to is kept.", pregenOff: "The area is called off.", killed: "The server's process has been ended.", mapReloaded: "BlueMap read its settings again; a render in hand is asked for again.",
  start: "Start sent to AMP.", stop: "Stop sent to AMP.", restart: "Restart sent to AMP.", action: "Done:", confirm: "Tick the confirmation box first.",
  groundClear: "Players have been warned in chat; items on the ground are cleared in 60 seconds.", groundPlan: "Saved.",
  distanceNow: "Saved. The server restarts in 1 minute; players have been warned.", distanceNext: "Saved. It takes effect at the next restart.",
  released: "Let in:", error: "That didn't work:", scheduled: "Restart planned in", cancelled: "The planned restart is called off.", backup: "Backup asked of AMP. It counts once AMP lists it; a big world takes a quarter of an hour or more.", announced: "Announcement posted",
};

/** The line an action leaves behind (`?msg=…&detail=…`). */
export function Flash({ msg, detail }: { msg?: string; detail?: string }) {
  if (!msg) return null;
  return <Alert tone={msg === "error" || msg === "confirm" ? "error" : "success"}>{MSG[msg] ?? msg} {detail && <span className="font-mono">{detail}</span>}</Alert>;
}

/** A hidden field that sends the admin back to the Control Room after the action, when the card sits there. */
const Back = ({ to }: { to?: "/admin" | "/admin/joining" }) => (to ? <input type="hidden" name="back" value={to} /> : null);

const CHECK_LABEL: Record<string, string> = { dump: "Database dump", dumpCopy: "Dump on the AMP host", backup: "World backup", pack: "Pack", wake: "Last wake" };

/**
 * docs/32 §7 item 3: what the health watch found wrong (dumps, backups, the pack, the last wake). Shown only while
 * something is wrong; the same lines go to the admin channel in Discord when they turn wrong.
 */
export function HealthCard({ view }: { view: WatchView | null }) {
  const wrong = Object.entries(view?.checks ?? {}).filter(([, c]) => c.ok === false);
  if (wrong.length === 0) return null;
  return (
    <Alert tone="error" data-testid="health-watch">
      <strong>Needs a look.</strong>
      <ul className="mt-1 list-disc pl-5">
        {wrong.map(([name, c]) => <li key={name}><span className="font-medium">{CHECK_LABEL[name] ?? name}:</span> {c.text}.</li>)}
      </ul>
      {view?.checkedAt && <span className="text-xs">Looked at {timeAgo(new Date(view.checkedAt))}; looked at again every ten minutes.</span>}
    </Alert>
  );
}

/** Why somebody is in the entrance room, in the words the event log uses. */
export function heldWhy(h: HeldEntry): string {
  if (h.kind === "link") return h.reason === "left the discord server" ? "left the Discord server; has to sign in and link again" : "has not linked their Minecraft account yet";
  const known = h.reason && h.reason in GATE_TEXT ? GATE_TEXT[h.reason as BlockReason] : null;
  return known ?? "has to press Play on the site";
}

/**
 * docs/32 §7 item 10 (the small part): who is in the entrance room and why, and Release for a linked member, so an
 * admin does not need the console to see why a friend cannot get in. Shown only while somebody is held.
 */
export function HeldCard({ held, back }: { held: HeldEntry[] | null; back?: "/admin" | "/admin/joining" }) {
  if (!held || held.length === 0) return null;
  return (
    <Card data-testid="held">
      <CardHeader>
        <CardTitle>In the entrance room · {held.length}</CardTitle>
        <CardDescription>The door lets each of them in by itself within seconds of what it waits for. Release lets a linked member in now, whatever the door says.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          {held.map((h) => (
            <li key={h.name} className="flex flex-wrap items-center gap-2 py-1.5" data-testid={`held-${h.name}`}>
              <span className="min-w-0 flex-1">
                <span className="font-mono">{h.name}</span> <span className="text-muted-foreground">{heldWhy(h)} · {timeAgo(new Date(h.since))}{h.member ? (h.back ? " · goes back to where they stood" : " · goes to spawn") : ""}</span>
              </span>
              {h.member && h.kind !== "link" ? (
                <form action={releaseHeldAction}>
                  <Back to={back} />
                  <input type="hidden" name="name" value={h.name} />
                  <Button type="submit" size="sm" variant="secondary">Release</Button>
                </form>
              ) : (
                <span className="text-xs text-muted-foreground">links on the site</span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function PowerCard({ status, players, back }: { status: LiveStatus; players: Players | null; back?: "/admin" }) {
  const a = statusText(status, true);
  const running = status.server === "online";
  // an admin may start it from anything that is not up or on its way: switched off, crashed, asleep
  const startable = status.server === "off" || status.server === "crashed" || status.server === "asleep";
  const stuck = status.stateCode === 45;
  return (
    <Card data-testid="power">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">Status <Badge tone={a.tone} data-testid="power-state">{a.line}</Badge>{status.server !== "unreachable" && <span className="text-xs font-normal text-muted-foreground">AMP: {status.state}</span>}</CardTitle>
        {(a.reason || status.server === "off" || status.server === "crashed") && <CardDescription>{a.hint}{a.reason && <> {a.reason}</>}</CardDescription>}
        <CardDescription>
          {status.server !== "unreachable" ? <>{running ? <>Up for {formatUptime(status.uptime) ?? "?"} · </> : null}CPU {status.cpu ?? "?"}% · RAM {status.memMb ?? "?"}{status.memMaxMb ? ` / ${status.memMaxMb}` : ""} MB · TPS {status.tps?.toFixed(1) ?? "no reading"} · online: {players?.online.length ? players.online.map((p) => `${p.name}${p.held ? " (in the room)" : ""}`).join(", ") : "nobody"}</> : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form action={serverOpAction.bind(null, "")} className="flex flex-wrap items-center gap-2">
          <Back to={back} />
          <label className="flex items-center gap-2 text-sm"><Check type="checkbox" name="sure" /> I&apos;m sure</label>
          <Button type="submit" formAction={serverOpAction.bind(null, "start")} size="sm" disabled={!startable}>Start</Button>
          <Button type="submit" formAction={serverOpAction.bind(null, "restart")} size="sm" variant="secondary" disabled={!running}>Restart now</Button>
          <Button type="submit" formAction={serverOpAction.bind(null, "stop")} size="sm" variant="danger" disabled={!running}>Stop</Button>
        </form>
        {stuck && (
          <form action={killAction} className="space-y-2 rounded-[4px] border border-l-[3px] border-l-danger bg-card p-3" data-testid="kill">
            <Back to={back} />
            <p className="text-sm">The server is stopping. That takes a minute at most; if it has been like this for several minutes it is stuck, and the only way out is to end its process. <strong>Whatever it had not saved is lost.</strong></p>
            <ConfirmSubmit question="End the server's process? Whatever it had not saved is lost. Only do this when the server has been stuck in Stopping for several minutes.">End the process</ConfirmSubmit>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function RestartCard({ schedule, running, back }: { schedule: Schedule | null; running: boolean; back?: "/admin" }) {
  const planned = schedule?.restart ?? null;
  return (
    <Card data-testid="restart">
      <CardHeader>
        <CardTitle>Restart with a warning</CardTitle>
        <HowThisWorks>Players are told in chat when you plan it (if it is more than five minutes away) and then every minute for the last five. If the site&apos;s backend is restarted in the meantime, the plan is dropped and nothing restarts.</HowThisWorks>
      </CardHeader>
      <CardContent className="space-y-3">
        {planned ? (
          <form action={cancelRestartAction} className="flex flex-wrap items-center gap-3">
            <Back to={back} />
            <p className="text-sm"><Badge tone="warn">Planned</Badge> Restarts at {new Date(planned.at).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })} UK time.</p>
            <Button type="submit" size="sm" variant="secondary">Call it off</Button>
          </form>
        ) : (
          <form action={scheduleRestartAction} className="flex flex-wrap items-end gap-2">
            <Back to={back} />
            <div><Label htmlFor={`minutes${back ? "-cr" : ""}`}>In how many minutes</Label><Input id={`minutes${back ? "-cr" : ""}`} name="minutes" type="number" min={1} max={120} defaultValue={5} className="h-8 w-24 text-sm" required /></div>
            <label className="flex items-center gap-2 pb-1.5 text-sm"><Check type="checkbox" name="sure" /> I&apos;m sure</label>
            <Button type="submit" size="sm" disabled={!running}>Plan restart</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/** Admin → Server → Settings (planner 2026-10-01): view and simulation distance, with the load next to them. */
export function DistanceCard({ distance, status, schedule }: { distance: Distance | null; status: LiveStatus; schedule: Schedule | null }) {
  const running = status.server === "online";
  const view = distance?.amp?.view ?? distance?.running?.view;
  const sim = distance?.amp?.sim ?? distance?.running?.sim;
  const allowed = distance?.allowed.view === true && distance.allowed.sim === true;
  const pending = distance ? waiting(distance) : [];
  const tick = distance?.tick ?? null;
  const planned = schedule?.restart ?? null;
  return (
    <Card data-testid="distance">
      <CardHeader>
        <CardTitle>View and simulation distance</CardTitle>
        <CardDescription>
          Now: view <strong data-testid="distance-running-view">{distance?.running?.view ?? "?"}</strong>, simulation <strong data-testid="distance-running-sim">{distance?.running?.sim ?? "?"}</strong> chunks
          {" · "}
          {running ? (
            tick ? (
              <span data-testid="distance-tick">TPS {tick.tps.toFixed(1)} · <Badge tone={msptTone(tick.mspt)}>MSPT {tick.mspt.toFixed(1)} ms</Badge> <span className="text-xs">({timeAgo(new Date(tick.at))})</span></span>
            ) : <>TPS {status.tps?.toFixed(1) ?? "no reading"}</>
          ) : <>the server isn&apos;t running, so there is no TPS to show</>}
        </CardDescription>
        <HowThisWorks>
          A tick is the server&apos;s heartbeat: 20 a second when all is well (TPS 20), so each may take up to 50 ms. MSPT is how long a tick really takes; under 35 ms there is room to spare, near 50 the server starts to fall behind and everything slows down. The numbers come from NeoForge&apos;s own tick report and are fresh every 15 seconds while this page is open. Neither distance can be changed while the server runs (nothing in the pack can do that on this NeoForge), so a change is saved in AMP and the server picks it up when it next starts.
        </HowThisWorks>
      </CardHeader>
      <CardContent className="space-y-4">
        {distance === null || view === undefined || sim === undefined ? (
          <Alert tone="error">Can&apos;t ask AMP for these settings right now.{distance?.problem ? <> <span className="font-mono">{distance.problem}</span></> : null}</Alert>
        ) : (
          <>
            {!allowed && (
              <Alert tone="error" data-testid="distance-permission">
                AMP doesn&apos;t let the site change these yet. In the instance&apos;s own panel, give the role of the user <span className="font-mono">webapp</span> the permissions{" "}
                <span className="font-mono">{distance.permissions.view}</span> and <span className="font-mono">{distance.permissions.sim}</span>.
              </Alert>
            )}
            {pending.length > 0 && (
              <div className="space-y-2 rounded-[4px] border p-3 text-sm" data-testid="distance-pending">
                <p>
                  <Badge tone="warn">Waiting for a restart</Badge>{" "}
                  {pending.map((p) => `${p.what} ${p.now ?? "?"} → ${p.next}`).join(", ")}
                  {planned && <> · restart planned at {new Date(planned.at).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })} UK time</>}
                </p>
                {!planned && running && (
                  <form action={distanceAction.bind(null, "now")}>
                    <input type="hidden" name="view" value={view} />
                    <input type="hidden" name="sim" value={sim} />
                    <ConfirmSubmit variant="secondary" question="Restart the server in 1 minute? Players get a warning in chat.">Apply now (restart with 1 minute warning)</ConfirmSubmit>
                  </form>
                )}
              </div>
            )}
            <DistanceForm key={`${view}-${sim}`} view={view} sim={sim} limits={distance.limits} running={running} allowed={allowed} applyNow={distanceAction.bind(null, "now")} applyNext={distanceAction.bind(null, "next")} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The last backup asked for from the portal: it counts only once AMP lists it (api status/backup-watch.ts). */
export function BackupJobLine({ job }: { job: BackupJob }) {
  const at = (iso: string | null) => (iso && !Number.isNaN(Date.parse(iso)) ? ukShort(new Date(iso)) : "");
  if (job.phase === "waiting") {
    return <Alert tone="warn" data-testid="backup-job" data-phase="waiting">Waiting for AMP to list <span className="font-mono">{job.title}</span> (asked {at(job.requestedAt)}{job.checkedAt ? `, last looked ${at(job.checkedAt)}` : ""}). Not kept until it shows in the list below.</Alert>;
  }
  if (job.phase === "listed") {
    return <Alert tone="success" data-testid="backup-job" data-phase="listed">Kept: <span className="font-mono">{job.title}</span>, listed by AMP {at(job.doneAt)}{job.sizeBytes ? `, ${(job.sizeBytes / 1e9).toFixed(1)} GB` : ""}.</Alert>;
  }
  return <Alert tone="error" role="alert" data-testid="backup-job" data-phase="failed">Not kept: <span className="font-mono">{job.title}</span>. {job.reason}</Alert>;
}

export function BackupCard({ backup, back, list = true }: { backup: Backup | null; back?: "/admin"; list?: boolean }) {
  return (
    <Card data-testid="backup">
      <CardHeader>
        <CardTitle>Back up now</CardTitle>
        <CardDescription>
          {backup === null ? "Can't ask AMP about backups right now." : backup.allowed ? <>Takes a backup with AMP&apos;s own backup tool.{backup.stopsServer ? " AMP says this stops the server while it runs." : ""}</> : <>Not switched on: the site&apos;s AMP user (<span className="font-mono">webapp</span>) isn&apos;t allowed to take backups. In AMP, give its role the permission <span className="font-mono">{backup.permission}</span>, or rely on AMP&apos;s backup schedule.</>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form action={backupAction} className="flex flex-wrap items-center gap-2">
          <Back to={back} />
          <label className="flex items-center gap-2 text-sm"><Check type="checkbox" name="sure" disabled={!backup?.allowed} /> I&apos;m sure</label>
          <Button type="submit" size="sm" variant="secondary" disabled={!backup?.allowed}>Back up</Button>
        </form>
        {backup?.job && <BackupJobLine job={backup.job} />}
        {list && (backup?.canList ? (
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
        ) : backup ? <p className="text-xs text-muted-foreground">To list the backups here as well, the AMP user needs <span className="font-mono">{backup.listPermission ?? "LocalFileBackup.Backup.ViewBackupsList"}</span>.</p> : null)}
        {list && <p className="text-xs text-muted-foreground">Restoring and deleting backups is done in AMP. The site cannot do either.</p>}
      </CardContent>
    </Card>
  );
}

export function PregenCard({ pregen, frontiers = [] }: { pregen: Pregen | null; frontiers?: Array<{ dimension: string; name: string }> }) {
  const mode = modeText(pregen);
  const prog = progress(pregen);
  const mapProg = mapProgress(pregen);
  // the map alone: chunky is not part of it and has nothing to say
  const renderOnly = pregen?.plan.mode !== undefined && pregen.plan.mode !== "off" && pregen.plan.what === "render";
  const sleepy = sleepText(pregen);
  return (
    <Card data-testid="pregen">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">Pre-generation <Badge tone={mode.tone}>{mode.label}</Badge></CardTitle>
        <CardDescription>Makes the world around spawn ahead of time and renders the map of it. <strong className="text-foreground">Off unless you turn it on here.</strong></CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm" data-testid="pregen-mode">{mode.line}</p>
        <div data-testid="pregen-progress">
          <p className="text-sm">{pregen?.plan.area ? <>Radius {pregen.plan.area.radius} around {pregen.plan.area.x}, {pregen.plan.area.z}. </> : null}{renderOnly ? null : prog.line}</p>
          {!renderOnly && prog.percent !== null && <span className="mt-1 block h-2 overflow-hidden border bg-panel" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(prog.percent)}><span className="block h-full bg-primary" style={{ width: `${Math.min(100, prog.percent)}%` }} /></span>}
        </div>
        {mapProg && (
          <div data-testid="pregen-map">
            <p className="text-sm">{mapProg.line}</p>
            {mapProg.percent !== null && <span className="mt-1 block h-2 overflow-hidden border bg-panel" role="progressbar" aria-label="Map render" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(mapProg.percent)}><span className="block h-full bg-primary" style={{ width: `${Math.min(100, mapProg.percent)}%` }} /></span>}
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
            <div>
              <Label htmlFor="pgw">World</Label>
              <select id="pgw" name="world" defaultValue={pregen?.plan.area?.world ?? "minecraft:overworld"} className={cn("mt-1 h-8 text-sm", fieldClasses)}>
                <option value="minecraft:overworld">Main world (around spawn)</option>
                <option value="minecraft:the_nether">The Nether (around 0, 0)</option>
                <option value="minecraft:the_end">The End (around 0, 0)</option>
                {frontiers.map((f) => <option key={f.dimension} value={f.dimension}>Frontier · {f.name} (around 0, 0)</option>)}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">One world at a time. A Frontier is in the list once its datapack is shipped; it exists on the server from the start after the Sync.</p>
            </div>
            <div><Label htmlFor="pgr">Radius, blocks</Label><Input id="pgr" name="radius" type="number" min={16} max={10000} defaultValue={pregen?.plan.area?.radius ?? 1500} className="h-8 w-28 text-sm" required /></div>
            <p className="text-xs text-muted-foreground">Around {pregen?.plan.area?.x ?? 0}, {pregen?.plan.area?.z ?? 0} (spawn). Another radius calls the present area off and begins a new one; what is already made is passed over quickly. Roughly: {[1500, 3000, 5000, 10000].map((r) => { const c = pregenCost(r); return `${r} = ${c.hours < 1 ? `${Math.round(c.hours * 60)} min` : `${c.hours.toFixed(1)} h`}, ${c.gb < 1 ? c.gb.toFixed(1) : Math.round(c.gb)} GB`; }).join(" · ")}.</p>
            <fieldset className="space-y-1 text-sm">
              <legend className="mb-1 font-medium">What</legend>
              <label className="flex items-center gap-2"><Check type="radio" name="what" value="both" defaultChecked />Generate, then render the map</label>
              <label className="flex items-center gap-2"><Check type="radio" name="what" value="generate" />Generate only</label>
              <label className="flex items-center gap-2"><Check type="radio" name="what" value="render" />Render the map only</label>
              <p className="text-xs text-muted-foreground">The map is BlueMap&apos;s, of the overworld, inside the radius. The server is kept awake until BlueMap says the map is up to date.</p>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="sr-only">Mode</legend>
              <label className="flex items-start gap-2 rounded-[4px] border p-3 text-sm">
                <Check className="mt-1" type="radio" name="mode" value="empty" defaultChecked />
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
              <label className="flex items-start gap-2 rounded-[4px] border p-3 text-sm">
                <Check className="mt-1" type="radio" name="mode" value="now" />
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
        <div className={`rounded-[4px] border p-3 text-xs ${sleepy.ok ? "text-muted-foreground" : "border-l-[3px] border-l-danger bg-card"}`} data-testid="pregen-sleep">
          <p>{sleepy.line}</p>
          {sleepy.grant && <p className="mt-1">To allow it: in the instance&apos;s own panel, give the role of the user <span className="font-mono">webapp</span> the permission Settings → MinecraftModule → Limits → SleepMode, <span className="font-mono">{sleepy.grant}</span>. The setting is <span className="font-mono">{pregen?.sleep.node}</span>.</p>}
        </div>
        <HowThisWorks>
          <p>Makes the world around spawn ahead of time and renders the map of it, so that exploring is smooth and the map is whole.</p>
          <p>A render that was not finished carries on by itself after a restart of the server or a power cut: the portal asks BlueMap for the map again as soon as the server is up.</p>
          <p>The server is never started from here, and never ended. If it is asleep or stopped, the pre-generation carries on the next time it runs. Hours are hours of generating and rendering, not hours on the clock.</p>
        </HowThisWorks>
      </CardContent>
    </Card>
  );
}

export function RoomCard({ players, running }: { players: Players | null; running: boolean }) {
  return (
    <Card data-testid="room">
      <CardHeader>
        <CardTitle>Entrance room</CardTitle>
        <CardDescription>{players?.held.length ? <>In the room now: {players.held.map((h) => h.name).join(", ")}</> : "Nobody is in the room right now."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form action={runActionAction}><input type="hidden" name="action" value="limbo.build" /><Button type="submit" size="sm" variant="secondary" disabled={!running}>Build the room</Button></form>
        <form action={runActionAction}><input type="hidden" name="action" value="opac.serverClaims" /><Button type="submit" size="sm" variant="secondary" disabled={!running}>Server-claim spawn and the room</Button></form>
        <HowThisWorks>Players who have not linked their account, or who have not pressed Play when Play first is on, or who the server is not open for yet, are held in a glass room in a dimension of its own (LIMBO_POS) with a line in chat telling them what to do (docs/14). Build it once per world, and again after a change to the room. &quot;Server-claim&quot; makes the spawn area (8×8 chunks around 0,0) and the room Open Parties and Claims server claims, so no player can claim them; once per world is enough. Who is let in is set on the Rules tab.</HowThisWorks>
      </CardContent>
    </Card>
  );
}

type News = Awaited<ReturnType<typeof getAnnouncements>>;

/**
 * docs/35: the map's own button, out of the Pre-generation card. Deleting the map and rendering it again stays in
 * that card's form: it runs in the mode picked there (when nobody is on, or now).
 */
export function MapCard() {
  return (
    <Card data-testid="map-card">
      <CardHeader>
        <CardTitle>Map</CardTitle>
        <CardDescription>BlueMap, the live map. Rendering it, and deleting it to render it again, are in Pre-generation above.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={pregenAction} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <input type="hidden" name="op" value="map-reload" />
          <Button type="submit" size="sm" variant="secondary">Reload BlueMap&apos;s settings</Button>
          <span>After a change to BlueMap&apos;s config (render threads) has been synced. A render in hand carries on.</span>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Was "Kick + unwhitelist" on the Entrance room card. The whitelist is off (docs/14), so what this does today: the
 * player loses the "verified" tag and is kicked, and meets the door again at their next join. By name, because it is
 * also for somebody who is not a member.
 */
export function KickCard({ running }: { running: boolean }) {
  return (
    <Card data-testid="kick">
      <CardHeader>
        <CardTitle>Kick a player back to the door</CardTitle>
        <CardDescription>Kicks them and takes their pass away, so the door looks at them again the next time they join: a member who may come in is let in as usual, anyone else waits in the entrance room.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={runActionAction} className="flex items-end gap-2">
          <input type="hidden" name="back" value="/admin/joining" />
          <input type="hidden" name="action" value="player.revoke" />
          <input type="hidden" name="reason" value="An admin sent you back to the door. Join again." />
          <div><Label htmlFor="rvname">Minecraft name</Label><Input id="rvname" name="name" placeholder="Minecraft name" pattern="[A-Za-z0-9_]{3,16}" className="h-8 w-40 text-sm" required /></div>
          <Button type="submit" size="sm" variant="danger" disabled={!running}>Kick</Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function AnnounceCard({ running }: { running: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Post news</CardTitle>
        <CardDescription>Shows under News on the home page.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={announceAction} className="space-y-2">
          <Label htmlFor="body" className="sr-only">Announcement</Label>
          <textarea id="body" name="body" maxLength={600} required rows={3} className={cn("min-h-11 py-2", fieldClasses)} placeholder="Server restarts at 8 for the new mods…" />
          <div><Label htmlFor="newsimage">Picture (optional)</Label><input id="newsimage" name="image" type="file" accept="image/png,image/jpeg,image/webp" className="block w-full text-sm file:mr-3 file:rounded-none file:border-2 file:border-edge file:bg-card-2 file:px-3 file:py-1.5 file:text-sm file:text-foreground" /></div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><Check type="checkbox" name="pinned" /> Pin to the top</label>
            <label className="flex items-center gap-2">Pinned until <Input name="pinnedUntil" type="datetime-local" className="h-8 w-auto text-sm" /></label>
            <label className="flex items-center gap-2">Hide from <Input name="expiresAt" type="datetime-local" className="h-8 w-auto text-sm" /></label>
            <label className="flex items-center gap-2"><Check type="checkbox" name="say" disabled={!running} /> Also say it in game</label>
            <Button type="submit" size="sm">Post</Button>
          </div>
          <HowThisWorks>A picture may be PNG, JPEG or WebP, 3 MB at most. &quot;Also say it in game&quot; says the first line (200 characters) in chat. Dates are UK time and optional: &quot;Pinned until&quot; pins it until then, &quot;Hide from&quot; takes it off the home page from then.</HowThisWorks>
        </form>
      </CardContent>
    </Card>
  );
}

export function AnnouncementsCard({ news }: { news: News }) {
  return (
    <Card>
      <CardHeader><CardTitle>Announcements</CardTitle><CardDescription>{news.length ? "The home page shows the pinned ones and the newest three." : "Nothing posted yet."}</CardDescription></CardHeader>
      {news.length > 0 && (
        <CardContent>
          <ul className="divide-y">
            {news.map((n) => (
              <li key={n.id} className="flex flex-wrap items-start gap-3 py-2 text-sm">
                {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded picture, served by our own route */}
                {n.image && <img src={n.image} alt="" loading="lazy" className="h-16 w-28 rounded border object-cover" />}
                <p className="min-w-0 flex-1 whitespace-pre-line">
                  {n.pinned && <Badge tone="warn" className="mr-2">{n.pinnedUntil ? `Pinned until ${ukShort(n.pinnedUntil)}` : "Pinned"}</Badge>}
                  {n.expired ? <Badge className="mr-2">Hidden since {ukShort(n.expiresAt!)}</Badge> : n.expiresAt && <Badge className="mr-2">Hidden from {ukShort(n.expiresAt)}</Badge>}
                  {n.body}<span className="block text-xs text-muted-foreground">{n.author} · {timeAgo(n.createdAt)}</span>
                </p>
                <form action={announcementChangeAction.bind(null, "picture")} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={n.id} />
                  <input name="image" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Picture" className="w-44 text-xs file:mr-2 file:rounded file:border file:bg-muted file:px-2 file:py-1 file:text-xs" />
                  <Button type="submit" formAction={announcementChangeAction.bind(null, "picture")} size="sm" variant="ghost">{n.image ? "Change picture" : "Add picture"}</Button>
                  {n.image && <Button type="submit" formAction={announcementChangeAction.bind(null, "nopicture")} size="sm" variant="ghost">No picture</Button>}
                </form>
                <form action={announcementChangeAction.bind(null, n.pinned ? "unpin" : "pin")} className="flex gap-1">
                  <input type="hidden" name="id" value={n.id} />
                  <Button type="submit" formAction={announcementChangeAction.bind(null, n.pinned ? "unpin" : "pin")} size="sm" variant="ghost">{n.pinned ? "Unpin" : "Pin"}</Button>
                  <Button type="submit" formAction={announcementChangeAction.bind(null, "delete")} size="sm" variant="ghost" className="text-danger">Delete</Button>
                </form>
                <form action={announcementDatesAction} className="flex w-full flex-wrap items-center gap-2 text-xs">
                  <input type="hidden" name="id" value={n.id} />
                  <label className="flex items-center gap-1">Pinned until <Input name="pinnedUntil" type="datetime-local" defaultValue={dateToUkLocal(n.pinned ? n.pinnedUntil : null)} className="h-7 w-auto text-xs" /></label>
                  <label className="flex items-center gap-1">Hide from <Input name="expiresAt" type="datetime-local" defaultValue={dateToUkLocal(n.expired ? null : n.expiresAt)} className="h-7 w-auto text-xs" /></label>
                  <Button type="submit" size="sm" variant="ghost">Save dates</Button>
                </form>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

/** What is lying around, by type, so a clear is only done when items really are the problem (planner, 2026-10-01). */
export function EntityCountsCard({ ground }: { ground: Ground | null }) {
  const c = ground?.counts ?? null;
  return (
    <Card data-testid="entity-counts">
      <CardHeader>
        <CardTitle>What&apos;s in the world right now</CardTitle>
        <CardDescription>
          Entities in loaded chunks, by type{c ? <> · counted {timeAgo(new Date(c.at))}</> : null}. Look here before clearing anything: if it isn&apos;t items, clearing items won&apos;t help.
        </CardDescription>
        <HowThisWorks>
          The portal asks the server <span className="font-mono">execute if entity …</span> for each type, at most once a minute while this page is open; the answers are kept off the console page. Only loaded chunks count: what is near players, plus anything kept loaded. Mob and contraption counts come from the pack&apos;s datapack <span className="font-mono">deepslate-tools</span>, which the server reads at its next start after a Sync.
        </HowThisWorks>
      </CardHeader>
      <CardContent>
        {!ground ? (
          <Alert tone="error">Can&apos;t ask the portal&apos;s api right now.</Alert>
        ) : !ground.running && !c ? (
          <p className="text-sm text-muted-foreground">The server isn&apos;t running, so there is nothing to count.</p>
        ) : (
          <dl className="grid gap-2 sm:grid-cols-2" data-testid="entity-counts-list">
            {COUNTED.map((what) => {
              const n = c?.values[what];
              const problem = c?.problems[what];
              return (
                <div key={what} className="flex items-start justify-between gap-3 rounded-[4px] border p-2" data-testid={`count-${what}`}>
                  <div className="min-w-0">
                    <dt className="text-sm font-medium">{LABELS[what].name}</dt>
                    <dd className="text-xs text-muted-foreground">{problem ? (/tag|function/i.test(problem) ? "Needs a server restart after the next Sync (datapack)." : `No answer: ${problem}`) : LABELS[what].hint}</dd>
                  </div>
                  <Badge tone={n === undefined ? "neutral" : countTone(what, n)} className="shrink-0 tabular-nums">{n === undefined ? "?" : n.toLocaleString("en-GB")}</Badge>
                </div>
              );
            })}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

/** "Clear ground items now" and the automatic clear (off unless turned on). Every clear is in the event log with its count. */
export function GroundClearCard({ ground }: { ground: Ground | null }) {
  const plan = ground?.plan ?? { auto: false, threshold: 1500 };
  const last = ground?.last ?? null;
  return (
    <Card data-testid="ground-clear">
      <CardHeader>
        <CardTitle>Clear items on the ground</CardTitle>
        <CardDescription>Warns everyone in chat 60 seconds and 10 seconds before, then removes dropped items that have been lying there for more than {Math.round((ground?.oldAfterSeconds ?? 120) / 60)} minutes.</CardDescription>
        <HowThisWorks>
          Only dropped items (<span className="font-mono">minecraft:item</span> entities) are ever removed, and only ones older than 2 minutes, so something a player just dropped is safe. Corpses, mobs, pets, item frames, armour stands, minecarts and Create or TaCZ entities are never touched. One &quot;item&quot; here is one stack lying on the ground. Every clear goes into the event log with how many went, whether someone pressed the button or the schedule did it.
        </HowThisWorks>
      </CardHeader>
      <CardContent className="space-y-4">
        {ground?.clearing ? (
          <Alert tone="success" data-testid="ground-clearing">{clearingText(ground.clearing)}</Alert>
        ) : (
          <form action={groundClearAction} className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm"><Check type="checkbox" name="sure" /> Yes, clear them</label>
            <ConfirmSubmit variant="secondary" disabled={!ground?.running} question="Warn everyone and clear items on the ground in 60 seconds?">Clear ground items now</ConfirmSubmit>
            {!ground?.running && <span className="text-xs text-muted-foreground">Only while the server is running.</span>}
          </form>
        )}
        {last && (
          <p className="text-sm" data-testid="ground-last">
            Last clear {timeAgo(new Date(last.at))}{last.by === "schedule" ? " (automatic)" : ""}:{" "}
            {last.problem ? <span className="text-danger">didn&apos;t work: {last.problem}</span> : <>{(last.removed ?? 0).toLocaleString("en-GB")} item{last.removed === 1 ? "" : "s"} removed{last.before !== null ? ` of ${last.before.toLocaleString("en-GB")} on the ground` : ""}.</>}
          </p>
        )}
        <form action={groundPlanAction} className="space-y-2 rounded-[4px] border p-3" data-testid="ground-plan">
          <p className="text-sm font-medium">Automatic</p>
          <p className="text-xs text-muted-foreground" data-testid="ground-plan-text">{planText(plan, ground?.checkEveryMin ?? 10)}</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-2 text-sm"><Check type="checkbox" name="auto" defaultChecked={plan.auto} /> Clear by itself when there are too many</label>
            <div>
              <Label htmlFor="ground-threshold">More than (items)</Label>
              <Input id="ground-threshold" name="threshold" type="number" min={200} max={20000} step={100} defaultValue={plan.threshold} className="w-28" />
            </div>
            <Button type="submit" variant="secondary">Save</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
