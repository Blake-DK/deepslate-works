import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check } from "@/components/ui/check";
import { ukDayTime } from "@/lib/uk-time";
import { timeAgo } from "@/lib/series";
import { db } from "@/server/db";
import { getMaintenance } from "@/server/settings";
import type { LiveStatus } from "@/server/status";
import { maintenanceAction } from "./maintenance-actions";
import type { HeldEntry } from "./server/cards";

export type MaintenanceView = {
  on: boolean;
  at: Date | null;
  by: string | null;
  /** the admins with the tick "Can join during maintenance", by name */
  ticked: string[];
  /** does the admin looking at it have the tick */
  mine: boolean;
  /** on the server now, and how many of them have no tick */
  online: number;
  wouldGo: number;
  /** held at the door for it now (on) */
  held: string[];
};

/** What the card shows. `held`: the entrance room now (api /held); null when api did not answer. */
export async function loadMaintenanceView(adminId: string, status: LiveStatus, held: HeldEntry[] | null): Promise<MaintenanceView> {
  const [m, ticked] = await Promise.all([
    getMaintenance(),
    db.user.findMany({ where: { role: "ADMIN", maintenanceJoin: true }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true, mcUuid: true } }),
  ]);
  const by = m.byId ? await db.user.findUnique({ where: { id: m.byId }, select: { displayName: true } }) : null;
  // everybody on the server but the admins with the tick goes when it is switched on, the room's people too
  const tickedUuids = new Set(ticked.map((t) => t.mcUuid).filter(Boolean));
  const onServer = status.server === "online" ? status.online : [];
  return {
    on: m.on, at: m.at, by: by?.displayName ?? null,
    ticked: ticked.map((t) => t.displayName), mine: ticked.some((t) => t.id === adminId),
    online: onServer.length, wouldGo: onServer.filter((p) => !(p.uuid && tickedUuids.has(p.uuid))).length,
    held: (held ?? []).filter((h) => h.reason === "maintenance").map((h) => h.name),
  };
}

/**
 * docs/48 B3: the site's Maintenance (not AMP's state of the same name), on both sites, each with its own switch. On
 * Admin → Server → Power & restarts (Alex, 2026-10-10: not on Overview, which only says when it is on). Off: what
 * it does, who has the tick, who would be kicked, "I'm sure" and Start. On: since when and by whom, who is held, End.
 */
export function MaintenanceCard({ v }: { v: MaintenanceView }) {
  return (
    <Card className={v.on ? "border-2 border-primary" : undefined} data-testid="maintenance">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">Maintenance <Badge tone={v.on ? "warn" : "neutral"} data-testid="maintenance-state">{v.on ? "on" : "off"}</Badge></CardTitle>
        {v.on ? (
          <CardDescription>
            On since {v.at ? `${ukDayTime(v.at)} (${timeAgo(v.at)})` : "?"}{v.by ? `, switched on by ${v.by}` : ""}. Only {v.ticked.length ? v.ticked.join(", ") : "admins with the tick"} can join; everybody else waits at the door with &quot;Down for maintenance&quot;.
          </CardDescription>
        ) : (
          <CardDescription>
            The server keeps running, but only admins with the tick &quot;Can join during maintenance&quot; get in. Everybody else on the server is kicked at once, and whoever joins waits at the door until it ends. Nothing is posted to Discord.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {v.on ? (
          <>
            <p data-testid="maintenance-held">{v.held.length ? <>Held for it now: <span className="font-mono">{v.held.join(", ")}</span>.</> : "Nobody is held for it now."}</p>
            <form action={maintenanceAction.bind(null, "off")}>
              <Button type="submit" size="sm">End maintenance</Button>
            </form>
          </>
        ) : (
          <>
            <p>With the tick: {v.ticked.length ? <span className="font-medium">{v.ticked.join(", ")}</span> : <span className="text-muted-foreground">nobody</span>}.</p>
            <p>{v.online} on the server now; {v.wouldGo === 0 ? "nobody would be kicked" : `${v.wouldGo} would be kicked`}.</p>
            {v.ticked.length === 0 ? (
              <p className="text-muted-foreground" data-testid="maintenance-no-tick">No admin has the tick, so nobody could get in. Give it in an admin&apos;s menu on <Link href="/admin/people" className="underline">People → Members</Link>: Can join during maintenance.</p>
            ) : !v.mine ? (
              <p className="text-danger" data-testid="maintenance-not-mine">You do not have the tick: you will be kicked too.</p>
            ) : null}
            <form action={maintenanceAction.bind(null, "on")} className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2"><Check type="checkbox" name="sure" disabled={v.ticked.length === 0} /> I&apos;m sure</label>
              <Button type="submit" size="sm" variant="danger" disabled={v.ticked.length === 0}>Start maintenance</Button>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}
