import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/session";
import { getStatus } from "@/server/status";
import { getAnnouncements } from "@/server/announcements";
import { TabbedPage, type PageQuery } from "@/components/tabs";
import { AnnounceCard, AnnouncementsCard, Flash } from "../server/cards";

export const metadata: Metadata = { title: "News" };

// docs/13 §11 layout: posting and looking after the news, out of the Server page.
export default async function NewsAdminPage({ searchParams }: { searchParams: PageQuery }) {
  await requireAdmin();
  const q = await searchParams;
  const [status, news] = await Promise.all([getStatus(), getAnnouncements(10, true)]);
  return (
    <TabbedPage title="News" intro="What members read under News on the home page." base="/admin/news" tabs={[]} current="">
      <Flash msg={typeof q.msg === "string" ? q.msg : undefined} detail={typeof q.detail === "string" ? q.detail : undefined} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <AnnounceCard running={status?.availability === "online"} />
        <AnnouncementsCard news={news} />
      </div>
    </TabbedPage>
  );
}
