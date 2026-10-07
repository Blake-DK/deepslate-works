import { apiFetch, ApiError } from "@/server/api-client";
import { timeAgo } from "@/lib/series";
import { playersText, stateText, suggestedPort, type RouterView } from "@/lib/router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Input, Label } from "@/components/ui/input";
import { HowThisWorks } from "@/components/tabs";
import { ConfirmSubmit } from "@/components/server/confirm-submit";
import { routerAddAction, routerRemoveAction } from "./actions";

// Admin → Server → Router (Alex, 2026-10-07): mc-router on the AMP host sends each game address (hostname) players type
// to the server behind it. Read from its dashboard through api; the page never talks to the AMP host itself.

type Caller = { id: string; role: "ADMIN" };
export type RouterLoad = { view: RouterView } | { error: string };

export async function loadRouter(caller: Caller): Promise<RouterLoad> {
  try {
    return { view: await apiFetch<RouterView>("/router", { caller, timeoutMs: 15_000 }) };
  } catch (e) {
    return { error: e instanceof ApiError ? e.message : "The site's backend did not answer." };
  }
}

const ago = (iso: string | null) => (iso ? timeAgo(new Date(iso)) : "never");

export function RouterPage({ load }: { load: RouterLoad }) {
  if ("error" in load) {
    return (
      <Alert tone="error" data-testid="router-down">
        The router dashboard on the AMP host cannot be read right now: <span className="font-mono">{load.error}</span>. Players can still join; this only
        affects this page. It runs on the AMP host next to mc-router, reached through the WireGuard tunnel.
      </Alert>
    );
  }
  const v = load.view;
  return (
    <div className="space-y-4">
      {!v.routerOk && <Alert tone="error">mc-router itself is not answering its dashboard{v.routerError ? `: ${v.routerError}` : ""}. Players may not be able to join any server.</Alert>}
      <RoutesCard view={v} />
      <div className="grid gap-4 lg:grid-cols-2">
        <AddRouteCard view={v} />
        <OnlineCard view={v} />
      </div>
      <LoginsCard view={v} />
    </div>
  );
}

function RoutesCard({ view: v }: { view: RouterView }) {
  return (
    <Card data-testid="router-routes">
      <CardHeader>
        <CardTitle>Game addresses</CardTitle>
        <CardDescription>
          Every address players can type in Minecraft, and the server it leads to. Checked by the AMP host {ago(v.updated)}. Last 24 hours: {v.day.logins ?? "?"} joins
          by {v.day.players ?? "?"} {v.day.players === 1 ? "player" : "players"}, {v.day.pings ?? "?"} server-list pings, {v.day.rejected ?? "?"} refused.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {v.routes.length === 0 && <p className="text-sm text-muted-foreground">No addresses yet.</p>}
        <ul className="divide-y divide-border">
          {v.routes.map((r) => {
            const st = stateText(r.state);
            const players = playersText(r);
            const kept = v.protectedHost === r.hostname;
            return (
              <li key={r.hostname} className="flex flex-wrap items-start justify-between gap-3 py-3" data-testid="router-route">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">{r.hostname}</span>
                    <Badge tone={st.tone}>{st.text}</Badge>
                    {kept && <Badge tone="info">players join Deepslate Works here</Badge>}
                    {r.dnsOk === false && <Badge tone="warn">DNS does not point here</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[r.label, r.port !== null ? `port ${r.port}` : null, r.version ? `Minecraft ${r.version}` : null, players].filter(Boolean).join(" · ")}
                  </p>
                  {r.motd && <p className="text-xs italic text-muted-foreground">{r.motd}</p>}
                  {r.error && r.state !== "online" && <p className="text-xs text-muted-foreground">{r.error}</p>}
                  {r.players.length > 0 && <p className="text-xs">On now: {r.players.join(", ")}</p>}
                  <p className="text-xs text-muted-foreground">Last used {ago(r.lastSeen)}{r.failed ? `, ${r.failed} failed ${r.failed === 1 ? "connection" : "connections"} kept in the log` : ""}.</p>
                </div>
                {!kept && (
                  <form action={routerRemoveAction}>
                    <input type="hidden" name="hostname" value={r.hostname} />
                    <ConfirmSubmit question={`Remove the address ${r.hostname}? Anyone who joins with it gets "unknown host" until it is added again. The server behind it is not touched.`}>Remove</ConfirmSubmit>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
        {v.unknownHosts.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Addresses people tried that lead nowhere: {v.unknownHosts.map((u) => `${u.hostname ?? "?"} (${u.tries ?? "?"}×, ${ago(u.last)})`).join("; ")}.
          </p>
        )}
        <HowThisWorks>
          <p>Every Minecraft server on the AMP host shares one public port. mc-router reads the address the player typed and passes them to the server behind it. Removing an address does not stop or delete a server.</p>
          <p>Up: the server answered like Minecraft. Port open, not answering yet: it is starting. Down: nothing is running behind it.</p>
          <p>The address players join Deepslate Works by is never removed from here. Every add and remove is in the event log.</p>
        </HowThisWorks>
      </CardContent>
    </Card>
  );
}

function AddRouteCard({ view: v }: { view: RouterView }) {
  const port = suggestedPort(v);
  return (
    <Card data-testid="router-add">
      <CardHeader>
        <CardTitle>Add a game address</CardTitle>
        <CardDescription>For a new server on the AMP host: the address players will type, and the game port AMP gave that server.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={routerAddAction} className="space-y-3">
          <div><Label htmlFor="rt-host">Address</Label><Input id="rt-host" name="hostname" placeholder="play.example.com" required maxLength={253} className="font-mono" /></div>
          <div className="flex flex-wrap gap-3">
            <div><Label htmlFor="rt-port">Port</Label><Input id="rt-port" name="port" type="number" required min={v.portMin ?? 1024} max={v.portMax ?? 65535} defaultValue={port} className="w-32" /></div>
            <div className="min-w-0 flex-1"><Label htmlFor="rt-label">Name (optional)</Label><Input id="rt-label" name="label" maxLength={60} placeholder="Vanilla" /></div>
          </div>
          {v.freePorts.length > 0 && <p className="text-xs text-muted-foreground">Free ports: {v.freePorts.slice(0, 8).join(", ")}{v.portMin !== null && v.portMax !== null ? ` (the router uses ${v.portMin} to ${v.portMax})` : ""}.</p>}
          <Button type="submit" size="sm">Add address</Button>
          <p className="text-xs text-muted-foreground">The address also needs a DNS record pointing at the home connection, like the others. The change takes effect at once, without a restart.</p>
        </form>
      </CardContent>
    </Card>
  );
}

function OnlineCard({ view: v }: { view: RouterView }) {
  return (
    <Card data-testid="router-online">
      <CardHeader>
        <CardTitle>Connected now</CardTitle>
        <CardDescription>Everyone mc-router has passed on and who has not left yet, on any server.</CardDescription>
      </CardHeader>
      <CardContent>
        {v.online.length === 0 ? <p className="text-sm text-muted-foreground">Nobody.</p> : (
          <ul className="space-y-1 text-sm">
            {v.online.map((p, i) => <li key={`${p.player}-${i}`}><span className="font-medium">{p.player ?? "?"}</span> <span className="text-muted-foreground">on {p.server ?? "?"}, since {ago(p.since)}</span></li>)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function LoginsCard({ view: v }: { view: RouterView }) {
  return (
    <Card data-testid="router-logins">
      <CardHeader>
        <CardTitle>Recent joins</CardTitle>
        <CardDescription>The last {v.logins.length} attempts to join any server through mc-router, newest first. The addresses they came from are for admins only.</CardDescription>
      </CardHeader>
      <CardContent>
        {v.logins.length === 0 ? <p className="text-sm text-muted-foreground">None kept.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground"><tr><th className="py-1 pr-3 font-medium">When</th><th className="pr-3 font-medium">Player</th><th className="pr-3 font-medium">Address</th><th className="pr-3 font-medium">Result</th><th className="font-medium">From</th></tr></thead>
              <tbody>
                {v.logins.map((l, i) => (
                  <tr key={`${l.at}-${i}`} className="border-t border-border">
                    <td className="whitespace-nowrap py-1 pr-3">{ago(l.at)}</td>
                    <td className="pr-3">{l.player ?? "?"}</td>
                    <td className="pr-3 font-mono">{l.server ?? "?"}</td>
                    <td className="pr-3">{l.ok ? <Badge tone="good">joined</Badge> : <Badge tone="bad" title={l.error ?? undefined}>failed</Badge>}</td>
                    <td className="font-mono text-muted-foreground">{l.client ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
