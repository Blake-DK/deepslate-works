import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth/session";
import { asSectionQuery, pickTab, TabbedPage, type PageQuery } from "@/components/tabs";
import SettingsSection from "../settings/section";
import BrandingSection from "../branding/section";

export const metadata: Metadata = { title: "Site" };

const TABS = [
  { key: "look", label: "Look" },
  { key: "pages", label: "Pages" },
  { key: "privacy", label: "Privacy & data" },
] as const;

// docs/35: what left this page, and where each old tab went.
const MOVED: Record<string, string> = {
  launch: "/admin/joining?tab=rules",
  joining: "/admin/joining?tab=rules",
  kept: "/admin/site?tab=privacy",
  files: "/admin/server?tab=files",
  branding: "/admin/site",
  discord: "/admin/discord",
};

// docs/35: the site itself and nothing else. Who gets in is on Joining, Discord has a page of its own, the file
// browser's limits are under the file browser, the server list's lines are on Server → World & map.
export default async function SiteAdminPage({ searchParams }: { searchParams: PageQuery }) {
  await requireAdmin();
  const q = await searchParams;
  if (typeof q.tab === "string" && MOVED[q.tab]) redirect(MOVED[q.tab]!);
  const tab = pickTab(q.tab, TABS);
  return (
    <TabbedPage title="Site" intro="How the site looks, what its pages say, and what it keeps about players." base="/admin/site" tabs={TABS} current={tab}>
      {tab === "privacy" ? <SettingsSection searchParams={asSectionQuery(q)} cards={["privacy", "kept"]} /> : <BrandingSection searchParams={asSectionQuery(q)} part={tab} />}
    </TabbedPage>
  );
}
