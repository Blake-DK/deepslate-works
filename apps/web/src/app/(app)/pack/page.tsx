import type { Metadata } from "next";
import { requireOnboardedUser } from "@/server/auth/session";
import { getOpenVote } from "@/server/vote/votes";
import { asSectionQuery, pickTab, TabbedPage, type PageQuery } from "@/components/tabs";
import ModsSection from "../mods/section";
import VoteSection from "../vote/section";
import ResultsSection from "../vote/results/section";

export const metadata: Metadata = { title: "Mods & vote" };

// docs/13 §11 layout: /mods, /vote and /vote/results as three tabs.
export default async function PackPage({ searchParams }: { searchParams: PageQuery }) {
  await requireOnboardedUser("/pack");
  const open = await getOpenVote();
  const tabs = [{ key: "mods", label: "Mod list" }, { key: "vote", label: "Vote", count: open ? "open" : null }, { key: "results", label: "Results" }] as const;
  const q = await searchParams;
  const tab = pickTab(q.tab, tabs);
  return (
    <TabbedPage title="Mods & vote" base="/pack" tabs={tabs} current={tab}>
      {tab === "mods" ? <ModsSection /> : tab === "vote" ? <VoteSection /> : <ResultsSection searchParams={asSectionQuery(q)} />}
    </TabbedPage>
  );
}
