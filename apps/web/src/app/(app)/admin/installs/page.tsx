import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { OUTCOMES, shortCpu, shortGpu, shortOs, summary, type SystemInfo } from "@/lib/install-report";
import { timeAgo } from "@/lib/series";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cell, Clip, Field, FixedTable } from "@/components/admin/parts";
import { getInstaller } from "@/server/modpack/lock";
import { isOutdated } from "@/lib/installer-version";
import { InstallerVersion } from "@/components/admin/installer-version";

export const metadata: Metadata = { title: "Installs" };

const TONE = { ok: "good", failed: "bad", cancelled: "warn" } as const;
const LABEL = { ok: "All good", failed: "Failed", cancelled: "Stopped" } as const;
const TIER: Record<string, string> = { LOW: "Older PC", MID: "Decent PC", HIGH: "Gaming PC" };

/** The short form in the column, the whole of it on hover. */
function Short({ full, short }: { full: string; short: string }) {
  return <span data-truncate title={full} className="block min-w-0 truncate">{short}</span>;
}

export default async function InstallsPage({ searchParams }: { searchParams: Promise<{ outcome?: string }> }) {
  await requireAdmin();
  const { outcome } = await searchParams;
  const only = (OUTCOMES as readonly string[]).includes(outcome ?? "") ? outcome : undefined;
  const [rows, counts, installer] = await Promise.all([
    db.installReport.findMany({ where: only ? { outcome: only } : undefined, orderBy: { at: "desc" }, take: 200, select: { id: true, userId: true, at: true, mode: true, updatedFrom: true, updateProblem: true, outcome: true, failedStep: true, packVersion: true, installerVersion: true, durationSec: true, system: true, tierBefore: true, tierMeasured: true, user: { select: { displayName: true, pcTier: true, mcUuid: true } } } }),
    db.installReport.groupBy({ by: ["outcome"], _count: { _all: true } }),
    getInstaller(),
  ]);
  const current = installer?.version ?? null;
  const n = (o: string) => counts.find((c) => c.outcome === o)?._count._all ?? 0;
  const total = counts.reduce((a, c) => a + c._count._all, 0);
  const now = new Date();
  // The group's PCs: each member's latest report, whatever the filter above says.
  const latest = await db.installReport.findMany({ orderBy: { at: "desc" }, distinct: ["userId"], take: 100, select: { id: true, at: true, system: true, tierMeasured: true, user: { select: { displayName: true, mcUuid: true } } } });
  const members = await db.user.count();
  const tiers = { HIGH: 0, MID: 0, LOW: 0 } as Record<string, number>;
  for (const l of latest) if (l.tierMeasured) tiers[l.tierMeasured] = (tiers[l.tierMeasured] ?? 0) + 1;
  // One line for each thing; what does not fit is cut with an ellipsis and whole on hover.
  const pc = (l: (typeof latest)[number]) => ({
    s: summary(l.system as SystemInfo),
    who: <Link href={`/admin/installs/${l.id}`} className="block min-w-0 font-medium hover:underline"><Clip text={l.user.displayName} /></Link>,
    cpu: <Short full={summary(l.system as SystemInfo).cpu} short={shortCpu(summary(l.system as SystemInfo).cpu)} />,
    gpu: <Short full={summary(l.system as SystemInfo).gpu} short={shortGpu(summary(l.system as SystemInfo).gpu)} />,
    tier: l.tierMeasured ? <Badge tone={l.tierMeasured === "HIGH" ? "good" : l.tierMeasured === "LOW" ? "warn" : "neutral"} className="whitespace-nowrap">{TIER[l.tierMeasured]}</Badge> : <span className="text-muted-foreground" title="Not enough in the report to go on">–</span>,
    when: <span title={l.at.toISOString()}>{timeAgo(l.at, now)}</span>,
  });
  const run = (r: (typeof rows)[number]) => {
    const changed = r.tierMeasured && r.tierBefore && r.tierMeasured !== r.tierBefore;
    const about = [r.failedStep ? `at "${r.failedStep}"` : null, r.updatedFrom ? `the installer updated itself, ${r.updatedFrom} to ${r.installerVersion}` : null, r.updateProblem ? "the installer could not update itself" : null].filter(Boolean).join("; ");
    return {
      s: summary(r.system as SystemInfo),
      who: <Link href={`/admin/installs/${r.id}`} className="block min-w-0 font-medium hover:underline"><Clip text={r.user.displayName} /></Link>,
      changed: changed ? <span className="shrink-0 cursor-help text-primary" title={`Their PC was measured on this run: was ${TIER[r.tierBefore!]}, measured ${TIER[r.tierMeasured!]}`} aria-label={`PC tier changed: was ${TIER[r.tierBefore!]}, measured ${TIER[r.tierMeasured!]}`}>●</span> : null,
      os: <Short full={summary(r.system as SystemInfo).os} short={shortOs(summary(r.system as SystemInfo).os)} />,
      gpu: <Short full={summary(r.system as SystemInfo).gpu} short={shortGpu(summary(r.system as SystemInfo).gpu)} />,
      when: <span title={r.at.toISOString()}>{timeAgo(r.at, now)}</span>,
      installer: <InstallerVersion version={r.installerVersion} current={current} outdated={isOutdated(r.installerVersion, current)} />,
      from: <span title={r.updatedFrom ? `updated itself, ${r.updatedFrom} to ${r.installerVersion}` : `installer ${r.installerVersion}`}>{r.mode === "play" ? "Play" : "Installer"}{r.updateProblem ? <span className="text-danger" title="The installer could not update itself"> !</span> : null}</span>,
      outcome: <Badge tone={TONE[r.outcome as keyof typeof TONE] ?? "neutral"} className="whitespace-nowrap" title={about || undefined}>{LABEL[r.outcome as keyof typeof LABEL] ?? r.outcome}{r.failedStep ? " …" : ""}</Badge>,
    };
  };
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Installs</h1>
        <p className="text-muted-foreground">What the Windows installer reported at the end of each run: how it went, the log, and the PC it ran on. No Windows user names, no addresses. Kept for 90 days.{current ? <> The installer the site hands out now is <span className="font-mono">{current}</span>; a run from an older one is marked &quot;outdated&quot;.</> : null}</p>
      </div>
      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <h2 className="text-lg font-semibold">The group&apos;s PCs</h2>
            <p className="text-sm text-muted-foreground">Measured by the installer, the latest run of each member. {latest.length} of {members} members measured: {tiers.HIGH} gaming PC, {tiers.MID} decent, {tiers.LOW} older. Members who have not run the installer yet keep the tier they picked.</p>
          </div>
          {latest.length > 0 && (
            <>
              <div className="hidden min-[800px]:block" data-testid="pcs-table">
                <FixedTable label="The group's PCs" widths={["27%", "13%", "21%", "9%", "18%", "12%"]} head={[{ text: "Who" }, { text: "Tier" }, { text: "Processor" }, { text: "Memory", right: true }, { text: "Graphics" }, { text: "Measured", right: true }]}>
                  {latest.map((l) => {
                    const p = pc(l);
                    return (
                      <tr key={l.id} data-row>
                        <td className={cell}>{p.who}</td>
                        <td className={cell}>{p.tier}</td>
                        <td className={cell}>{p.cpu}</td>
                        <td className={`${cell} text-right tabular-nums`}>{p.s.ram}</td>
                        <td className={cell}>{p.gpu}</td>
                        <td className={`${cell} text-right text-muted-foreground`}>{p.when}</td>
                      </tr>
                    );
                  })}
                </FixedTable>
              </div>
              <ul className="space-y-2 min-[800px]:hidden" data-testid="pcs-cards">
                {latest.map((l) => {
                  const p = pc(l);
                  return (
                    <li key={l.id} data-row className="rounded-lg border p-3">
                      <div className="flex min-w-0 items-center gap-2">{p.who}<span className="ml-auto shrink-0">{p.tier}</span></div>
                      <dl className="mt-1 divide-y text-sm">
                        <Field name="Processor">{p.cpu}</Field>
                        <Field name="Memory"><span className="tabular-nums">{p.s.ram}</span></Field>
                        <Field name="Graphics">{p.gpu}</Field>
                        <Field name="Measured"><span className="text-muted-foreground">{p.when}</span></Field>
                      </dl>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
      <h2 className="pt-2 text-lg font-semibold">Every run</h2>
      <nav className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-sm" aria-label="Filter by outcome">
        <Link href="/admin/installs" aria-current={!only ? "page" : undefined} className={`whitespace-nowrap rounded-md px-3 py-1.5 ${!only ? "bg-card font-medium shadow-sm" : "hover:bg-card"}`}>All ({total})</Link>
        {OUTCOMES.map((o) => <Link key={o} href={`/admin/installs?outcome=${o}`} aria-current={only === o ? "page" : undefined} className={`whitespace-nowrap rounded-md px-3 py-1.5 ${only === o ? "bg-card font-medium shadow-sm" : "hover:bg-card"}`}>{LABEL[o]} ({n(o)})</Link>)}
      </nav>
      {rows.length === 0 ? (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">{only ? "No reports with that outcome." : "No reports yet. They arrive when someone runs the installer."}</CardContent></Card>
      ) : (
        <>
          <Card className="hidden min-[800px]:block" data-testid="runs-table">
            <CardContent className="p-2">
              <FixedTable label="Every run" widths={["18%", "10%", "8%", "13%", "11%", "12%", "11%", "7%", "10%"]} head={[{ text: "Who" }, { text: "When", right: true }, { text: "From" }, { text: "Installer" }, { text: "Outcome" }, { text: "Pack" }, { text: "Windows" }, { text: "Memory", right: true }, { text: "Graphics" }]}>
                {rows.map((r) => {
                  const p = run(r);
                  return (
                    <tr key={r.id} data-row>
                      <td className={cell}><span className="flex min-w-0 items-center gap-2">{p.who}{p.changed}</span></td>
                      <td className={`${cell} text-right text-muted-foreground`}>{p.when}</td>
                      <td className={cell}>{p.from}</td>
                      <td className={cell}>{p.installer}</td>
                      <td className={cell}>{p.outcome}</td>
                      <td className={cell}><Clip text={r.packVersion} mono className="text-xs" /></td>
                      <td className={cell}>{p.os}</td>
                      <td className={`${cell} text-right tabular-nums`}>{p.s.ram}</td>
                      <td className={cell}>{p.gpu}</td>
                    </tr>
                  );
                })}
              </FixedTable>
            </CardContent>
          </Card>
          <ul className="space-y-3 min-[800px]:hidden" data-testid="runs-cards">
            {rows.map((r) => {
              const p = run(r);
              return (
                <li key={r.id}>
                  <Card data-row>
                    <CardContent className="p-4">
                      <div className="flex min-w-0 items-center gap-2">{p.who}<span className="ml-auto shrink-0">{p.outcome}</span></div>
                      <dl className="mt-2 divide-y text-sm">
                        <Field name="When"><span className="text-muted-foreground">{p.when}</span></Field>
                        <Field name="From">{p.from}{p.changed}</Field>
                        <Field name="Installer">{p.installer}</Field>
                        <Field name="Pack"><Clip text={r.packVersion} mono className="text-xs" /></Field>
                        <Field name="Windows">{p.os}</Field>
                        <Field name="Memory"><span className="tabular-nums">{p.s.ram}</span></Field>
                        <Field name="Graphics">{p.gpu}</Field>
                      </dl>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
