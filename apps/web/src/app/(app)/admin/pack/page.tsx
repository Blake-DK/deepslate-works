import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { asSectionQuery, pickTab, TabbedPage, type PageQuery } from "@/components/tabs";
import ModpackSection from "../modpack/section";
import VotesSection from "../votes/section";
import ApplySection from "../../vote/results/apply/section";

export const metadata: Metadata = { title: "Modpack" };

// docs/13 §11 layout: /admin/modpack, the season's mod vote and /vote/results/apply as three tabs.
// docs/35: called Modpack (members have "Mods & vote" at /pack); the quick polls moved to Admin → News & polls (docs/48).
export default async function PackAdminPage({ searchParams }: { searchParams: PageQuery }) {
  await requireAdmin();
  const q = await searchParams;
  if (q.tab === "votes") redirect("/admin/news?tab=polls");
  const [votes, closed] = await Promise.all([db.vote.count(), db.vote.count({ where: { status: "CLOSED" } })]);
  const tabs = [{ key: "build", label: "Mods & build" }, { key: "modvote", label: "Mod vote", count: votes || null }, ...(closed ? [{ key: "apply", label: "Apply results" }] : [])];
  const tab = pickTab(q.tab, tabs);
  return (
    <TabbedPage title="Modpack" intro="The mod list, the season's mod vote, and getting the pack onto the server." base="/admin/pack" tabs={tabs} current={tab}>
      {tab === "build" ? <ModpackSection /> : tab === "modvote" ? <VotesSection searchParams={asSectionQuery(q)} part="modvote" /> : <ApplySection searchParams={asSectionQuery(q)} />}
    </TabbedPage>
  );
}
