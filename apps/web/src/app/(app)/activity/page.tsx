import type { Metadata } from "next";
import { requireOnboardedUser } from "@/server/auth/session";
import { readFilter } from "@/lib/event-query";
import { latestEventId, listEvents } from "@/server/event-log";
import { EventPage } from "@/components/events/event-page";
import type { PageQuery } from "@/components/tabs";

export const metadata: Metadata = { title: "Activity" };

// docs/13 §11 layout: one event log for everyone. Players see the trimmed log (joins, leaves, deaths, advancements,
// server up and down: no addresses, no console lines, nothing admins did); admins see every kind, each row's
// console line, and Export CSV. This was /events and /admin/events.
export default async function ActivityPage({ searchParams }: { searchParams: PageQuery }) {
  const user = await requireOnboardedUser("/activity");
  const admin = user.role === "ADMIN";
  const filter = readFilter(await searchParams, admin);
  const [{ rows, more }, newest] = await Promise.all([listEvents(filter, admin), latestEventId()]);
  return <EventPage base="/activity" admin={admin} filter={filter} rows={rows} more={more} newest={newest.toString()} />;
}
