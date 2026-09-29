import type { Metadata } from "next";
import { requireOnboardedUser } from "@/server/auth/session";
import { readFilter } from "@/lib/event-query";
import { latestEventId, listEvents } from "@/server/event-log";
import { EventPage } from "@/components/events/event-page";

export const metadata: Metadata = { title: "Events" };

// The trimmed log everyone may read: joins, leaves, deaths, advancements, server up and down.
// No addresses, no console lines, nothing admins did. Admins get the same trimmed view here.
export default async function EventsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOnboardedUser("/events");
  const filter = readFilter(await searchParams, false);
  const [{ rows, more }, newest] = await Promise.all([listEvents(filter, false), latestEventId()]);
  return <EventPage base="/events" admin={false} filter={filter} rows={rows} more={more} newest={newest.toString()} />;
}
