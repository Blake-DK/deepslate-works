import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { asSectionQuery, pickTab, TabbedPage, type PageQuery } from "@/components/tabs";
import ModpackSection from "../modpack/section";
import VotesSection from "../votes/section";
import ApplySection from "../../vote/results/apply/section";

export const metadata: Metadata = { title: "Pack" };

// docs/13 §11 layout: /admin/modpack, /admin/votes and /vote/results/apply as three tabs.
export default async function PackAdminPage({ searchParams }: { searchParams: PageQuery }) {
  await requireAdmin();
  const [votes, closed] = await Promise.all([db.vote.count(), db.vote.count({ where: { status: "CLOSED" } })]);
  const tabs = [{ key: "build", label: "Build & sync" }, { key: "votes", label: "Votes", count: votes || null }, ...(closed ? [{ key: "apply", label: "Apply results" }] : [])];
  const q = await searchParams;
  const tab = pickTab(q.tab, tabs);
  return (
    <TabbedPage title="Pack" intro="The mod list, the season votes, and getting the pack onto the server." base="/admin/pack" tabs={tabs} current={tab}>
      {tab === "build" ? <ModpackSection /> : tab === "votes" ? <VotesSection searchParams={asSectionQuery(q)} /> : <ApplySection searchParams={asSectionQuery(q)} />}
    </TabbedPage>
  );
}
