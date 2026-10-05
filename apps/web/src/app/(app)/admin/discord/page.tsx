import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/session";
import { asSectionQuery, pickTab, TabbedPage, type PageQuery } from "@/components/tabs";
import DiscordSection from "./section";

export const metadata: Metadata = { title: "Discord" };

const TABS = [
  { key: "connection", label: "Connection" },
  { key: "bot", label: "Channels & bot" },
  { key: "posted", label: "What is posted" },
] as const;

// docs/35: Discord as a page of its own (it was the seventh tab of Site settings): whether it is connected and the
// tests, the channels and the bot's switches, and what the feed posts.
export default async function DiscordAdminPage({ searchParams }: { searchParams: PageQuery }) {
  await requireAdmin();
  const q = await searchParams;
  const tab = pickTab(q.tab, TABS);
  return (
    <TabbedPage title="Discord" intro="The feed, the bot, and what they post." base="/admin/discord" tabs={TABS} current={tab}>
      <DiscordSection searchParams={asSectionQuery(q)} tab={tab} />
    </TabbedPage>
  );
}
