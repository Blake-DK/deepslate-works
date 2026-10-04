import type { Metadata } from "next";
import { getExtraNames } from "@/server/modpack/lock";
import { extrasLine, extrasReportSchema } from "@/lib/extras-line";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { markLog, settingsSchema, settingsText, suggestTier, summary, type SystemInfo } from "@/lib/install-report";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";

/** What each kind of run was (docs/07). Before 1.5.0 "install" was Setup.bat and "play" the Play button. */
const RUN: Record<string, string> = {
  install: "Setup.bat (installer before 1.5.0)",
  play: "Play (from 1.5.0 on: everything was already current)",
  first_install: "First install",
  update: "Play: the pack had changed and was updated",
  already_running: "Play while another copy was running: nothing done",
  uninstall: "Uninstall: Deepslate Works was taken off this PC (the account and the Minecraft link stay)",
  update_only: "Update: the app's Update button brought this PC up to date without starting the game",
};

export const metadata: Metadata = { title: "Install report" };

const TONE = { ok: "good", failed: "bad", cancelled: "warn", skipped: "neutral" } as const;
const LABEL = { ok: "All good", failed: "Failed", cancelled: "Stopped", skipped: "Already running" } as const;
const TIER: Record<string, string> = { LOW: "Older PC", MID: "Decent PC", HIGH: "Gaming PC" };
const MARK = { step: "bg-card-2 font-semibold text-primary-hi", after: "bg-card", fail: "bg-card-2 font-semibold text-danger" } as const;
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
    ["PowerShell", sys.powershell], ["Run", RUN[r.mode] ?? r.mode], ["Installer", r.updatedFrom ? `${r.installerVersion} (updated itself from ${r.updatedFrom} on this run)` : r.installerVersion], ...(r.updateProblem ? [["Installer update", `not applied: ${r.updateProblem}`] as [string, string]] : []), ["Pack", r.packVersion], ["Took", `${r.durationSec} s`],
    // installer 1.5.6: what could not be set up on the PC, each with its reason code
    ...(((r.setupProblems as Array<{ part: string; code: string; message: string }> | null) ?? []).map((p, i): [string, string] => [i === 0 ? "Setup" : " ".repeat(i), `${p.message} (${p.part}, ${p.code})`])),
    ...(Array.isArray(r.setupProblems) && r.setupProblems.length === 0 ? [["Setup", "Home copy, Play button, shortcuts and Settings entry all in place"] as [string, string]] : []),
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-semibold">{r.user.displayName} <span className="text-base font-normal text-muted-foreground">· {when.format(r.at)}</span></h1>
        <Link href="/admin/people?tab=installs" className={buttonClasses("secondary", "sm")}>All installs</Link>
      </div>
      <Alert tone={r.outcome === "ok" ? "success" : r.outcome === "skipped" ? "info" : "error"}>
        <Badge tone={TONE[r.outcome as keyof typeof TONE] ?? "neutral"} className="mr-2">{LABEL[r.outcome as keyof typeof LABEL] ?? r.outcome}</Badge>
        {r.outcome === "ok" ? "The installer ran through." : r.outcome === "skipped" ? "Another copy was already running on this PC, so this one did nothing." : r.failedStep ? <>Stopped at the step &quot;{r.failedStep}&quot;. It is marked in the log below.</> : "Stopped before the first step."}
      </Alert>
      {r.extras ? <p className="text-sm" data-testid="report-extras">{extrasLine(extrasReportSchema.safeParse(r.extras).data ?? null, await getExtraNames())}</p> : null}
      {r.settings ? <p className="text-sm" data-testid="report-settings">{settingsText(settingsSchema.safeParse(r.settings).data ?? null)}</p> : null}
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
          <div className="max-h-[40rem] overflow-auto rounded-[4px] border bg-panel" tabIndex={0} aria-label="Install log">
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
