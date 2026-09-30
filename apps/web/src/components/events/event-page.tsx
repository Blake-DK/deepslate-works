import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { EVENT_KINDS, KIND_LABEL, PLAYER_KINDS } from "@/shared/events";
import { filterToQuery, type EventFilter } from "@/lib/event-query";
import type { EventRow } from "@/server/event-log";
import { EventItem } from "./event-list";
import { LiveTail } from "./live-tail";

/** The event log at /activity: everything for admins, trimmed for players. */
export function EventPage({ base, admin, filter, rows, more, newest }: { base: string; admin: boolean; filter: EventFilter; rows: EventRow[]; more: boolean; newest: string }) {
  const kinds = admin ? EVENT_KINDS : PLAYER_KINDS;
  const query = filterToQuery(filter);
  const last = rows.at(-1);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="text-muted-foreground">{admin ? "Everything the server and the site have seen or done. Open a row for the original console line and the details." : "Who came and went, deaths, advancements, and when the server was up."}</p>
      </div>
      <Card>
        <CardContent className="p-4">
          <form method="get" action={base} className="space-y-3">
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Show</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {kinds.map((k) => (
                  <label key={k} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="kind" value={k} defaultChecked={filter.kinds.includes(k)} className="h-4 w-4" /> {KIND_LABEL[k]}</label>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Nothing ticked means everything.</p>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-4">
              <div><Label htmlFor="player">Player</Label><Input id="player" name="player" defaultValue={filter.player ?? ""} placeholder="Minecraft or display name" className="h-9 text-sm" /></div>
              <div><Label htmlFor="from">From</Label><Input id="from" name="from" type="date" defaultValue={filter.from?.toISOString().slice(0, 10) ?? ""} className="h-9 text-sm" /></div>
              <div><Label htmlFor="to">To</Label><Input id="to" name="to" type="date" defaultValue={filter.to?.toISOString().slice(0, 10) ?? ""} className="h-9 text-sm" /></div>
              <div><Label htmlFor="q">Words</Label><Input id="q" name="q" defaultValue={filter.text ?? ""} placeholder="in the message" className="h-9 text-sm" /></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm">Filter</Button>
              <Link href={base} className={buttonClasses("ghost", "sm")}>Clear</Link>
              {admin && <a href={`/api/admin/events/export${query}`} className={buttonClasses("secondary", "sm")}>Export CSV</a>}
            </div>
          </form>
        </CardContent>
      </Card>
      <LiveTail query={query} after={newest} scope={admin ? "admin" : "player"} />
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Nothing matches.</p> : <ul className="divide-y">{rows.map((e) => <EventItem key={e.id} e={e} admin={admin} />)}</ul>}
        </CardContent>
      </Card>
      {more && last && <Link href={`${base}${filterToQuery(filter, { before: last.id })}`} className={buttonClasses("secondary", "sm")}>Older</Link>}
    </div>
  );
}
