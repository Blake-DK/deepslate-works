import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { asSectionQuery, pickTab, TabbedPage, type PageQuery } from "@/components/tabs";
import MembersSection from "../users/section";
import InvitesSection from "../invites/section";
import InstallsSection from "../installs/section";
import { TEST_MODES } from "@/shared/join-gate";

export const metadata: Metadata = { title: "People" };

// docs/13 §11 layout: /admin/users, /admin/invites and /admin/installs as three tabs. An install report
// (/admin/installs/<id>) stays a page of its own.
export default async function PeopleAdminPage({ searchParams }: { searchParams: PageQuery }) {
  await requireAdmin();
  const [members, invites, installs] = await Promise.all([
    db.user.count(),
    db.invite.count({ where: { usedBy: null, expiresAt: { gt: new Date() } } }),
    db.installReport.count({ where: { mode: { notIn: TEST_MODES } } }),
  ]);
  const tabs = [{ key: "members", label: "Members", count: members }, { key: "invites", label: "Invites", count: invites || null }, { key: "installs", label: "Installs", count: installs || null }] as const;
  const q = await searchParams;
  const tab = pickTab(q.tab, tabs);
  return (
    <TabbedPage title="People" base="/admin/people" tabs={tabs} current={tab}>
      {tab === "members" ? <MembersSection searchParams={asSectionQuery(q)} /> : tab === "invites" ? <InvitesSection /> : <InstallsSection searchParams={asSectionQuery(q)} />}
    </TabbedPage>
  );
}
