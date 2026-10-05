import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { asSectionQuery, TabbedPage, type PageQuery } from "@/components/tabs";
import VotesSection from "./section";

export const metadata: Metadata = { title: "Votes" };

// docs/35: the quick polls, a page of their own to match the members' Votes tab. The season's mod vote stays with the
// pack it decides (Modpack → Mod vote).
export default async function VotesAdminPage({ searchParams }: { searchParams: PageQuery }) {
  await requireAdmin();
  const q = await searchParams;
  return (
    <TabbedPage title="Votes" intro={<>Quick polls: what members answer under Votes. The season&apos;s mod vote is on <Link href="/admin/pack?tab=modvote" className="underline">Modpack → Mod vote</Link>.</>} base="/admin/votes" tabs={[]} current="">
      <VotesSection searchParams={asSectionQuery(q)} part="polls" />
    </TabbedPage>
  );
}
