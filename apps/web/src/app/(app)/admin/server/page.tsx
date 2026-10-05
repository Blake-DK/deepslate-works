import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/session";
import { redirect } from "next/navigation";
import { getStatus } from "@/server/status";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { asSectionQuery, pickTab, TabbedPage, type PageQuery } from "@/components/tabs";
import { LiveConsole } from "@/components/server/live-console";
import FilesSection from "../files/section";
import SettingsSection from "../settings/section";
import { BrandingForm } from "../branding/form";
import { BrandingSaved, brandingValues } from "../branding/section";
import { saveBrandingAction } from "../branding/actions";
import { getFrontiers } from "@/server/season";
import { BackupCard, consoleLines, DistanceCard, EntityCountsCard, Flash, GroundClearCard, loadGround, loadBackup, loadDistance, loadPlayers, loadPregen, loadSchedule, loadTail, MapCard, PowerCard, PregenCard, RestartCard } from "./cards";

export const metadata: Metadata = { title: "Server" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

const TABS = [
  { key: "power", label: "Power & restarts" },
  { key: "performance", label: "Performance" },
  { key: "backups", label: "Backups" },
  { key: "world", label: "World & map" },
  { key: "console", label: "Console" },
  { key: "files", label: "Files" },
] as const;

// docs/35: tabs that were renamed or moved; their old addresses are sent on.
const MOVED: Record<string, string> = { settings: "/admin/server?tab=performance", pregen: "/admin/server?tab=world", room: "/admin/joining?tab=room" };

// docs/13 §11 layout: what was one long page is tabs; each loads only what it shows. News has its own page.
// docs/35: Performance (was Settings), World & map (pre-generation, the map, the server list's lines), and the file
// browser's limits under the browser. The entrance room is on Joining.
export default async function ServerAdminPage({ searchParams }: { searchParams: PageQuery }) {
  const admin = await requireAdmin();
  const q = await searchParams;
  if (typeof q.tab === "string" && MOVED[q.tab]) redirect(MOVED[q.tab]!);
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
  } else if (tab === "performance") {
    const [distance, schedule, ground] = await Promise.all([loadDistance(caller), loadSchedule(caller), loadGround(caller)]);
    body = (
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2"><DistanceCard distance={distance} status={status} schedule={schedule} /></div>
        <EntityCountsCard ground={ground} />
        <GroundClearCard ground={ground} />
      </div>
    );
  } else if (tab === "backups") {
    const backup = await loadBackup(caller);
    body = <>{backup?.job?.phase === "waiting" && <AutoRefresh seconds={30} />}<BackupCard backup={backup} /></>;
  } else if (tab === "world") {
    const [pregen, initial] = await Promise.all([loadPregen(caller), brandingValues(admin.id, true)]);
    body = (
      <div className="space-y-4">
        <BrandingSaved saved={one(q.saved)} error={one(q.error)} note={one(q.note)} />
        <PregenCard pregen={pregen} frontiers={await getFrontiers()} />
        <MapCard />
        <Card data-testid="motd-card">
          <CardHeader><CardTitle>Server description</CardTitle><CardDescription>The two lines under the server&apos;s name in Minecraft&apos;s server list.</CardDescription></CardHeader>
          <CardContent><BrandingForm action={saveBrandingAction} initial={initial} part="motd" /></CardContent>
        </Card>
      </div>
    );
  } else if (tab === "console") {
    const tail = await loadTail(caller);
    body = (
      <Card>
        <CardHeader><CardTitle>Console</CardTitle><CardDescription>The Minecraft server&apos;s console, live. Players never see this.</CardDescription></CardHeader>
        <CardContent><LiveConsole initial={consoleLines(tail)} height="h-[28rem]" /></CardContent>
      </Card>
    );
  } else {
    body = <div className="space-y-4"><FilesSection searchParams={asSectionQuery(q)} /><SettingsSection searchParams={asSectionQuery(q)} cards={["files"]} /></div>;
  }

  return (
    <TabbedPage title="Server" base="/admin/server" tabs={TABS} current={tab}>
      {tab !== "files" && tab !== "console" && <AutoRefresh seconds={15} />}
      <Flash msg={msg} detail={detail} />
      {body}
    </TabbedPage>
  );
}
