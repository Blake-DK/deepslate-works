import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { markLog, suggestTier, summary, type SystemInfo } from "@/lib/install-report";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";

export const metadata: Metadata = { title: "Install report" };

const TONE = { ok: "good", failed: "bad", cancelled: "warn" } as const;
const LABEL = { ok: "All good", failed: "Failed", cancelled: "Stopped" } as const;
const TIER: Record<string, string> = { LOW: "Older PC", MID: "Decent PC", HIGH: "Gaming PC" };
const MARK = { step: "bg-primary/15 font-semibold", after: "bg-primary/5", fail: "bg-danger/15 font-semibold text-danger" } as const;
const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export default async function InstallReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/.test(id)) notFound();
  const r = await db.installReport.findUnique({ where: { id }, include: { user: { select: { displayName: true, pcTier: true, mcUuid: true } } } });
  if (!r) notFound();
  const sys = r.system as SystemInfo;
  const s = summary(sys);
  const guess = suggestTier(sys);
  const lines = markLog(r.log, r.failedStep);
  const rows: Array<[string, string | null | undefined]> = [
    ["Windows", `${s.os}${sys.os?.arch ? `, ${sys.os.arch}` : ""}`], ["Processor", s.cpu], ["Memory", s.ram],
    ["Graphics", (sys.gpus ?? []).map((g) => `${g.name ?? "?"}${g.driver ? ` (driver ${g.driver})` : ""}${g.vramMb ? `, ${Math.round(g.vramMb / 1024)} GB` : ""}`).join("; ") || "not known"],
    ["Free disk", sys.disk?.freeGb != null ? `${Math.round(sys.disk.freeGb)} GB free${sys.disk.totalGb ? ` of ${Math.round(sys.disk.totalGb)}` : ""} on ${sys.disk.drive ?? "the install drive"}` : "not known"],
    ["Launcher", sys.launcher?.version || sys.launcher?.kind ? `${sys.launcher.kind ?? ""} ${sys.launcher.version ?? ""}`.trim() : "not known"],
    ["Java", sys.java?.version ? `${sys.java.version}${sys.java.source ? ` (${sys.java.source})` : ""}` : "not found"], ["Java path", sys.java?.path],
    ["NeoForge", sys.neoforge ? `${sys.neoforge.version ?? "?"}: ${sys.neoforge.before ? "there before" : "not there before"}, ${sys.neoforge.after ? "there after" : "not there after"}` : "not known"],
    ["PowerShell", sys.powershell], ["Installer", r.installerVersion], ["Pack", r.packVersion], ["Took", `${r.durationSec} s`],
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-semibold">{r.user.displayName} <span className="text-base font-normal text-muted-foreground">· {when.format(r.at)}</span></h1>
        <Link href="/admin/installs" className={buttonClasses("secondary", "sm")}>All installs</Link>
      </div>
      <Alert tone={r.outcome === "ok" ? "success" : "error"}>
        <Badge tone={TONE[r.outcome as keyof typeof TONE] ?? "neutral"} className="mr-2">{LABEL[r.outcome as keyof typeof LABEL] ?? r.outcome}</Badge>
        {r.outcome === "ok" ? "The installer ran through." : r.failedStep ? <>Stopped at the step &quot;{r.failedStep}&quot;. It is marked in the log below.</> : "Stopped before the first step."}
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>The PC</CardTitle>
          <CardDescription>
            {guess ? <>Measured: <strong>{TIER[guess.tier]}</strong> ({guess.why}).{r.tierBefore && r.tierBefore !== guess.tier ? <> Before this run their tier was <strong>{TIER[r.tierBefore]}</strong>; it was set to the measured one.</> : r.tierBefore ? " The same as before this run." : ""}</> : "Not enough in this report to work out the PC tier; theirs was left as it was."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            {rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>)}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Log</CardTitle><CardDescription>As the installer wrote it, with names in paths, tokens and addresses taken out ({lines.length} lines).</CardDescription></CardHeader>
        <CardContent>
          <div className="max-h-[40rem] overflow-auto rounded-lg border bg-muted" tabIndex={0} aria-label="Install log">
            <table className="w-full border-separate border-spacing-0 font-mono text-xs leading-relaxed">
              <tbody>
                {lines.map((l) => (
                  <tr key={l.n} className={l.mark ? MARK[l.mark] : undefined} id={l.mark === "step" ? "failed" : undefined}>
                    <td className="w-px select-none whitespace-nowrap border-r px-2 text-right text-muted-foreground">{l.n}</td>
                    <td className="whitespace-pre-wrap break-all px-3">{l.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
