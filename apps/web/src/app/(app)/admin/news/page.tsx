import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { getStatus } from "@/server/status";
import { getAnnouncements } from "@/server/announcements";
import { db } from "@/server/db";
import { asSectionQuery, pickTab, TabbedPage, type PageQuery } from "@/components/tabs";
import { AnnounceCard, AnnouncementsCard, Flash } from "../server/cards";
import VotesSection from "../votes/section";

export const metadata: Metadata = { title: "News & polls" };

// docs/13 §11 layout: posting and looking after the news, out of the Server page. docs/48 A4: the quick polls (were
// Admin → Votes) are this page's second tab; /admin/votes is sent here (next.config.ts). The season's mod vote stays
// with the pack it decides (Modpack → Mod vote).
export default async function NewsAdminPage({ searchParams }: { searchParams: PageQuery }) {
  await requireAdmin();
  const q = await searchParams;
  const open = await db.poll.count({ where: { status: "OPEN" } });
  const tabs = [{ key: "news", label: "News" }, { key: "polls", label: "Polls", count: open || null }] as const;
  const tab = pickTab(q.tab, tabs);
  let body: React.ReactNode;
  if (tab === "news") {
    const [status, news] = await Promise.all([getStatus(), getAnnouncements(10, true)]);
    body = (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">News</h2>
        <Flash msg={typeof q.msg === "string" ? q.msg : undefined} detail={typeof q.detail === "string" ? q.detail : undefined} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <AnnounceCard running={status.server === "online"} />
          <AnnouncementsCard news={news} />
        </div>
      </div>
    );
  } else {
    body = <VotesSection searchParams={asSectionQuery(q)} part="polls" />;
  }
  return (
    <TabbedPage
      title="News & polls"
      intro={<>What members read under News on the home page, and the quick polls they answer under Votes. The season&apos;s mod vote is on <Link href="/admin/pack?tab=modvote" className="underline">Modpack → Mod vote</Link>.</>}
      base="/admin/news"
      tabs={tabs}
      current={tab}
    >
      {body}
    </TabbedPage>
  );
}
