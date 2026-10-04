import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { everything, filterToQuery, filterWords, groupLit, groupsFor, toggleGroup, type EventFilter } from "@/lib/event-query";
import type { EventRow } from "@/server/event-log";
import { EventItem } from "./event-list";
import { LiveList, LiveTail, LiveToggle } from "./live-tail";

// docs/29: the log is the page. Heading, one line of words, one row of chips, then the list; player, dates and
// words behind "More filters". Each chip is a link, so it works without JavaScript and a filtered view can be linked.

function Chip({ href, lit, children }: { href: string; lit: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={lit ? "true" : undefined}
      className={cn(
        // docs/23 §5's Badge, lit in the tab strip's Copper
        "inline-flex items-center rounded-[3px] border bg-card-2 px-2.5 py-1 text-[13px] font-semibold",
        lit ? "border-primary text-primary-hi" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

/** The event log at /activity: everything for admins, trimmed for players. */
export function EventPage({ base, admin, filter, rows, more, newest }: { base: string; admin: boolean; filter: EventFilter; rows: EventRow[]; more: boolean; newest: string }) {
  const query = filterToQuery(filter);
  const last = rows.at(-1);
  const words = filterWords(filter, admin);
  const moreOpen = Boolean(filter.player || filter.from || filter.to || filter.text);
  const firstPage = filter.before === null;
  const page = (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="text-muted-foreground">{admin ? "Everything the server and the site have seen or done, newest first. Open a row for the console line and the details." : "Who came and went, deaths, advancements, and when the server was up."}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2" data-testid="chips">
        <Chip href={`${base}${filterToQuery(everything(filter))}`} lit={filter.kinds.length === 0}>Everything</Chip>
        {groupsFor(admin).map((g) => (
          <Chip key={g.key} href={`${base}${filterToQuery(toggleGroup(filter, g))}`} lit={groupLit(filter, g)}>{g.label}</Chip>
        ))}
        {firstPage && <LiveToggle />}
      </div>
      <details open={moreOpen} className="rounded-[4px] border bg-card">
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium">More filters</summary>
        <form method="get" action={base} className="space-y-3 px-4 pb-4">
          {filter.kinds.length > 0 && <input type="hidden" name="kind" value={filter.kinds.join(",")} />}
          <div className="grid gap-3 sm:grid-cols-4">
            <div><Label htmlFor="player">Player</Label><Input id="player" name="player" defaultValue={filter.player ?? ""} placeholder="Minecraft or display name" className="h-9 text-sm" /></div>
            <div><Label htmlFor="from">From</Label><Input id="from" name="from" type="date" defaultValue={filter.from?.toISOString().slice(0, 10) ?? ""} className="h-9 text-sm" /></div>
            <div><Label htmlFor="to">To</Label><Input id="to" name="to" type="date" defaultValue={filter.to?.toISOString().slice(0, 10) ?? ""} className="h-9 text-sm" /></div>
            <div><Label htmlFor="q">Words</Label><Input id="q" name="q" defaultValue={filter.text ?? ""} placeholder="in the message" className="h-9 text-sm" /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm">Apply</Button>
            {admin && <a href={`/api/admin/events/export${query}`} className={buttonClasses("secondary", "sm")}>Export CSV</a>}
          </div>
        </form>
      </details>
      {words && (
        <p className="text-sm text-muted-foreground" data-testid="showing">
          {words} · <Link href={base} className="underline">Clear</Link>
        </p>
      )}
      <Card>
        <CardContent className="p-0">
          <LiveList admin={admin} empty={rows.length === 0}>
            {rows.map((e) => <EventItem key={e.id} e={e} admin={admin} />)}
          </LiveList>
        </CardContent>
      </Card>
      {more && last && <Link href={`${base}${filterToQuery(filter, { before: last.id })}`} className={buttonClasses("secondary", "sm")}>Older</Link>}
    </div>
  );
  // New rows belong on top of the newest page; an Older page stays as it is.
  return firstPage ? <LiveTail query={query} after={newest} scope={admin ? "admin" : "player"}>{page}</LiveTail> : page;
}
