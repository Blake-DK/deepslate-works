import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/session";
import { apiFetch } from "@/server/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Input, Label } from "@/components/ui/input";
import { runActionAction, serverOpAction } from "./actions";

export const metadata: Metadata = { title: "Server" };

type Status = { state: string; players: string[]; cpu: number | null; memMb: number | null; memMaxMb?: number | null; uptime: string | null };
type Players = { state: number; online: Array<{ name: string; uuid: string | null; held: boolean }>; held: Array<{ name: string; since: string }> };
type Tail = { state: number; lines: string[] };

const MSG: Record<string, string> = { start: "Start sent to AMP.", stop: "Stop sent to AMP.", restart: "Restart sent to AMP.", action: "Done.", confirm: "Tick the confirmation box first.", error: "AMP said no:" };

export default async function ServerAdminPage({ searchParams }: { searchParams: Promise<{ msg?: string; detail?: string }> }) {
  const admin = await requireAdmin();
  const { msg, detail } = await searchParams;
  const caller = { id: admin.id, role: "ADMIN" as const };
  const [status, players, tail] = await Promise.all([
    apiFetch<Status>("/status", { caller }).catch(() => null),
    apiFetch<Players>("/players", { caller }).catch(() => null),
    apiFetch<Tail>("/console/tail?lines=120", { caller }).catch(() => null),
  ]);
  const running = status?.state === "Running";
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Server</h1>
      {msg && <Alert tone={msg === "error" || msg === "confirm" ? "error" : "success"}>{MSG[msg] ?? msg} {detail && <span className="font-mono">{detail}</span>}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Status <Badge tone={running ? "good" : status ? "warn" : "bad"}>{status?.state ?? "api unreachable"}</Badge></CardTitle>
          <CardDescription>
            {status ? <>Uptime {status.uptime ?? "?"} · CPU {status.cpu ?? "?"}% · RAM {status.memMb ?? "?"}{status.memMaxMb ? ` / ${status.memMaxMb}` : ""} MB · online: {players?.online.length ? players.online.map((p) => `${p.name}${p.held ? " (in the room)" : ""}`).join(", ") : "nobody"}</> : "Can't reach the api service."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form action={serverOpAction} className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sure" className="h-4 w-4" /> I&apos;m sure</label>
            <Button type="submit" name="op" value="start" size="sm" disabled={running}>Start</Button>
            <Button type="submit" name="op" value="restart" size="sm" variant="secondary" disabled={!running}>Restart</Button>
            <Button type="submit" name="op" value="stop" size="sm" variant="danger" disabled={!running}>Stop</Button>
          </form>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
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
          <CardHeader><CardTitle>Announce</CardTitle><CardDescription>Runs <span className="font-mono">say</span> in game.</CardDescription></CardHeader>
          <CardContent>
            <form action={runActionAction} className="flex items-end gap-2">
              <input type="hidden" name="action" value="server.say" />
              <div className="flex-1"><Label htmlFor="say">Message</Label><Input id="say" name="text" maxLength={200} required className="h-8 text-sm" /></div>
              <Button type="submit" size="sm" disabled={!running}>Say</Button>
            </form>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Console (last 120 lines)</CardTitle><CardDescription>Read-only. Reload the page to refresh. Players never see this.</CardDescription></CardHeader>
        <CardContent><pre className="max-h-96 overflow-auto rounded-lg border bg-muted p-3 text-xs leading-relaxed">{tail?.lines.length ? tail.lines.join("\n") : "(nothing yet: the api tails the console from when it started)"}</pre></CardContent>
      </Card>
    </div>
  );
}
