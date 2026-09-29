import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/session";
import { readFilter } from "@/lib/event-query";
import { latestEventId, listEvents } from "@/server/event-log";
import { EventPage } from "@/components/events/event-page";

export const metadata: Metadata = { title: "Event log" };

export default async function AdminEventsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const filter = readFilter(await searchParams, true);
  const [{ rows, more }, newest] = await Promise.all([listEvents(filter, true), latestEventId()]);
  return <EventPage base="/admin/events" admin filter={filter} rows={rows} more={more} newest={newest.toString()} />;
}
