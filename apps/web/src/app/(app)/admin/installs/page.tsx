import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { OUTCOMES, summary, type SystemInfo } from "@/lib/install-report";
import { timeAgo } from "@/lib/series";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Installs" };

const TONE = { ok: "good", failed: "bad", cancelled: "warn" } as const;
const LABEL = { ok: "All good", failed: "Failed", cancelled: "Stopped" } as const;
const TIER: Record<string, string> = { LOW: "Older PC", MID: "Decent PC", HIGH: "Gaming PC" };

export default async function InstallsPage({ searchParams }: { searchParams: Promise<{ outcome?: string }> }) {
  await requireAdmin();
  const { outcome } = await searchParams;
  const only = (OUTCOMES as readonly string[]).includes(outcome ?? "") ? outcome : undefined;
  const [rows, counts] = await Promise.all([
    db.installReport.findMany({ where: only ? { outcome: only } : undefined, orderBy: { at: "desc" }, take: 200, select: { id: true, userId: true, at: true, mode: true, outcome: true, failedStep: true, packVersion: true, installerVersion: true, durationSec: true, system: true, tierBefore: true, tierMeasured: true, user: { select: { displayName: true, pcTier: true, mcUuid: true } } } }),
    db.installReport.groupBy({ by: ["outcome"], _count: { _all: true } }),
  ]);
  const n = (o: string) => counts.find((c) => c.outcome === o)?._count._all ?? 0;
  const total = counts.reduce((a, c) => a + c._count._all, 0);
  const now = new Date();
  // The group's PCs: each member's latest report, whatever the filter above says.
  const latest = await db.installReport.findMany({ orderBy: { at: "desc" }, distinct: ["userId"], take: 100, select: { id: true, at: true, system: true, tierMeasured: true, user: { select: { displayName: true, mcUuid: true } } } });
  const members = await db.user.count();
  const tiers = { HIGH: 0, MID: 0, LOW: 0 } as Record<string, number>;
  for (const l of latest) if (l.tierMeasured) tiers[l.tierMeasured] = (tiers[l.tierMeasured] ?? 0) + 1;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Installs</h1>
        <p className="text-muted-foreground">What the Windows installer reported at the end of each run: how it went, the log, and the PC it ran on. No Windows user names, no addresses. Kept for 90 days.</p>
      </div>
      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <h2 className="text-lg font-semibold">The group&apos;s PCs</h2>
            <p className="text-sm text-muted-foreground">Measured by the installer, the latest run of each member. {latest.length} of {members} members measured: {tiers.HIGH} gaming PC, {tiers.MID} decent, {tiers.LOW} older. Members who have not run the installer yet keep the tier they picked.</p>
          </div>
          {latest.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 pr-4 font-normal">Who</th><th className="py-1 pr-4 font-normal">Tier</th><th className="py-1 pr-4 font-normal">Processor</th><th className="py-1 pr-4 font-normal">Memory</th><th className="py-1 pr-4 font-normal">Graphics</th><th className="py-1 font-normal">Measured</th></tr></thead>
                <tbody className="divide-y">
                  {latest.map((l) => {
                    const s = summary(l.system as SystemInfo);
                    return <tr key={l.id}><td className="py-1.5 pr-4"><Link href={`/admin/installs/${l.id}`} className="font-medium hover:underline">{l.user.displayName}</Link></td><td className="py-1.5 pr-4">{l.tierMeasured ? <Badge tone={l.tierMeasured === "HIGH" ? "good" : l.tierMeasured === "LOW" ? "warn" : "neutral"}>{TIER[l.tierMeasured]}</Badge> : <span className="text-muted-foreground">not enough to go on</span>}</td><td className="py-1.5 pr-4">{s.cpu}</td><td className="py-1.5 pr-4 tabular-nums">{s.ram}</td><td className="py-1.5 pr-4">{s.gpu}</td><td className="py-1.5 text-muted-foreground">{timeAgo(l.at, now)}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <h2 className="pt-2 text-lg font-semibold">Every run</h2>
      <nav className="flex flex-wrap gap-1 rounded-lg bg-muted p-1 text-sm" aria-label="Filter by outcome">
        <Link href="/admin/installs" aria-current={!only ? "page" : undefined} className={`rounded-md px-3 py-1.5 ${!only ? "bg-card font-medium shadow-sm" : "hover:bg-card"}`}>All ({total})</Link>
        {OUTCOMES.map((o) => <Link key={o} href={`/admin/installs?outcome=${o}`} aria-current={only === o ? "page" : undefined} className={`rounded-md px-3 py-1.5 ${only === o ? "bg-card font-medium shadow-sm" : "hover:bg-card"}`}>{LABEL[o]} ({n(o)})</Link>)}
      </nav>
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{only ? "No reports with that outcome." : "No reports yet. They arrive when someone runs the installer."}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2 font-normal">Who</th><th className="px-4 py-2 font-normal">When</th><th className="px-4 py-2 font-normal">From</th><th className="px-4 py-2 font-normal">Outcome</th><th className="px-4 py-2 font-normal">Pack</th><th className="px-4 py-2 font-normal">Windows</th><th className="px-4 py-2 font-normal">Memory</th><th className="px-4 py-2 font-normal">Graphics</th></tr></thead>
                <tbody className="divide-y">
                  {rows.map((r) => {
                    const sys = r.system as SystemInfo;
                    const s = summary(sys);
                    const changed = r.tierMeasured && r.tierBefore && r.tierMeasured !== r.tierBefore;
                    return (
                      <tr key={r.id}>
                        <td className="px-4 py-2"><Link href={`/admin/installs/${r.id}`} className="font-medium hover:underline">{r.user.displayName}</Link>{changed && <span className="block text-xs text-primary">was {TIER[r.tierBefore!]}, measured {TIER[r.tierMeasured!]}</span>}</td>
                        <td className="px-4 py-2 text-muted-foreground" title={r.at.toISOString()}>{timeAgo(r.at, now)}</td>
                        <td className="px-4 py-2">{r.mode === "play" ? "Play" : "Installer"}</td>
                        <td className="px-4 py-2"><Badge tone={TONE[r.outcome as keyof typeof TONE] ?? "neutral"}>{LABEL[r.outcome as keyof typeof LABEL] ?? r.outcome}</Badge>{r.failedStep && <span className="block text-xs text-muted-foreground">at &quot;{r.failedStep}&quot;</span>}</td>
                        <td className="px-4 py-2 font-mono text-xs">{r.packVersion}</td>
                        <td className="px-4 py-2">{s.os}</td>
                        <td className="px-4 py-2 tabular-nums">{s.ram}</td>
                        <td className="px-4 py-2">{s.gpu}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
