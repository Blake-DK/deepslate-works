import type { Metadata } from "next";
import { requireOnboardedUser } from "@/server/auth/session";
import { asSectionQuery, pickTab, TabbedPage, type PageQuery } from "@/components/tabs";
import InstallSection from "../install/section";
import GuideSection from "../guide/section";
import RulesSection from "../rules/section";

export const metadata: Metadata = { title: "Help" };

const TABS = [{ key: "in", label: "Getting in" }, { key: "guide", label: "Guide" }, { key: "rules", label: "Rules" }] as const;

// docs/13 §11 layout: what used to be /install, /guide and /rules, as three tabs.
export default async function HelpPage({ searchParams }: { searchParams: PageQuery }) {
  await requireOnboardedUser("/help");
  const q = await searchParams;
  const tab = pickTab(q.tab, TABS);
  return (
    <TabbedPage title="Help" base="/help" tabs={TABS} current={tab}>
      {tab === "in" ? <InstallSection searchParams={asSectionQuery(q)} /> : tab === "guide" ? <GuideSection /> : <RulesSection />}
    </TabbedPage>
  );
}
