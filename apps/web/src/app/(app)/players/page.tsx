import type { Metadata } from "next";
import { requireOnboardedUser } from "@/server/auth/session";
import { getSection } from "@/server/site-settings";
import { asSectionQuery, pickTab, TabbedPage, type PageQuery } from "@/components/tabs";
import PeopleSection from "./people-section";
import StatsSection from "../analytics/section";

export const metadata: Metadata = { title: "Players" };

// docs/13 §11 layout: /players and /analytics as two tabs. With "Players can see the Stats tab" off, players do not
// see the tab at all (before, the link was there and sent them home).
export default async function PlayersPage({ searchParams }: { searchParams: PageQuery }) {
  const user = await requireOnboardedUser("/players");
  const privacy = await getSection("privacy");
  const stats = user.role === "ADMIN" || privacy.analyticsForPlayers;
  const tabs = stats ? ([{ key: "people", label: "People" }, { key: "stats", label: "Stats" }] as const) : ([{ key: "people", label: "People" }] as const);
  const q = await searchParams;
  const tab = pickTab(q.tab, tabs);
  return (
    <TabbedPage title={stats ? "Players & stats" : "Players"} base="/players" tabs={tabs} current={tab}>
      {tab === "stats" ? <StatsSection searchParams={asSectionQuery(q)} /> : <PeopleSection />}
    </TabbedPage>
  );
}
