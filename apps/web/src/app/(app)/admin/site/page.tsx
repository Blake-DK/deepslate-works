import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/session";
import { asSectionQuery, pickTab, TabbedPage, type PageQuery } from "@/components/tabs";
import SettingsSection from "../settings/section";
import BrandingSection from "../branding/section";

export const metadata: Metadata = { title: "Site settings" };

const TABS = [
  { key: "launch", label: "Launch" },
  { key: "joining", label: "Joining" },
  { key: "privacy", label: "Privacy" },
  { key: "kept", label: "Kept for" },
  { key: "files", label: "File browser" },
  { key: "branding", label: "Branding" },
] as const;

// docs/13 §11 layout: /admin/settings (one tab for each of its cards) and /admin/branding.
export default async function SiteAdminPage({ searchParams }: { searchParams: PageQuery }) {
  await requireAdmin();
  const q = await searchParams;
  const tab = pickTab(q.tab, TABS);
  return (
    <TabbedPage title="Site settings" base="/admin/site" tabs={TABS} current={tab}>
      {tab === "branding" ? <BrandingSection searchParams={asSectionQuery(q)} /> : <SettingsSection searchParams={asSectionQuery(q)} tab={tab} />}
    </TabbedPage>
  );
}
