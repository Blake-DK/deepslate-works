import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/session";
import { getStatus } from "@/server/status";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { asSectionQuery, pickTab, TabbedPage, type PageQuery } from "@/components/tabs";
import { LiveConsole } from "@/components/server/live-console";
import FilesSection from "../files/section";
import { BackupCard, consoleLines, Flash, loadBackup, loadPlayers, loadPregen, loadSchedule, loadTail, PowerCard, PregenCard, RestartCard, RoomCard } from "./cards";

export const metadata: Metadata = { title: "Server" };

const TABS = [
  { key: "power", label: "Power & restarts" },
  { key: "backups", label: "Backups" },
  { key: "pregen", label: "Pre-generation" },
  { key: "room", label: "Entrance room" },
  { key: "console", label: "Console" },
  { key: "files", label: "Files" },
] as const;

// docs/13 §11 layout: what was one long page is six tabs; each loads only what it shows. News has its own page.
export default async function ServerAdminPage({ searchParams }: { searchParams: PageQuery }) {
  const admin = await requireAdmin();
  const q = await searchParams;
  const tab = pickTab(q.tab, TABS);
  const caller = { id: admin.id, role: "ADMIN" as const };
  const msg = typeof q.msg === "string" ? q.msg : undefined;
  const detail = typeof q.detail === "string" ? q.detail : undefined;
  const status = await getStatus();
  const running = status.server === "online";

  let body: React.ReactNode;
  if (tab === "power") {
    const [players, schedule] = await Promise.all([loadPlayers(caller), loadSchedule(caller)]);
    body = <div className="grid gap-4 md:grid-cols-2"><div className="md:col-span-2"><PowerCard status={status} players={players} /></div><RestartCard schedule={schedule} running={running} /></div>;
  } else if (tab === "backups") {
    body = <BackupCard backup={await loadBackup(caller)} />;
  } else if (tab === "pregen") {
    body = <PregenCard pregen={await loadPregen(caller)} />;
  } else if (tab === "room") {
    body = <RoomCard players={await loadPlayers(caller)} running={running} />;
  } else if (tab === "console") {
    const tail = await loadTail(caller);
    body = (
      <Card>
        <CardHeader><CardTitle>Console</CardTitle><CardDescription>The Minecraft server&apos;s console, live. Players never see this.</CardDescription></CardHeader>
        <CardContent><LiveConsole initial={consoleLines(tail)} height="h-[28rem]" /></CardContent>
      </Card>
    );
  } else {
    body = <FilesSection searchParams={asSectionQuery(q)} />;
  }

  return (
    <TabbedPage title="Server" base="/admin/server" tabs={TABS} current={tab}>
      {tab !== "files" && tab !== "console" && <AutoRefresh seconds={15} />}
      <Flash msg={msg} detail={detail} />
      {body}
    </TabbedPage>
  );
}
