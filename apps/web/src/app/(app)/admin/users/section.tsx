import Link from "next/link";
import { installedNow } from "@/lib/play";
import { db } from "@/server/db";
import { requireAdmin } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { timeAgo, cn } from "@/lib/utils";
import { memberRows, SHOW, type Show } from "@/lib/admin-lists";
import { cell, Clip, Field, FixedTable, menuCell, Switch } from "@/components/admin/parts";
import { getInstaller } from "@/server/modpack/lock";
import { isOutdated } from "@/lib/installer-version";
import { InstallerVersion } from "@/components/admin/installer-version";
import { setEarlyAccessAction, unblockAction } from "./actions";
import { blockedList } from "@/server/auth/blocked";
import { MemberMenu } from "./member-menu";
import { stripLink } from "@/components/strip-link";
import { TabStrip } from "@/components/tabs";
import { fieldClasses } from "@/components/ui/input";
import { TEST_MODES } from "@/shared/join-gate";
import { getStatus } from "@/server/status";
import { pingTone } from "@/lib/ping";
import { Flash, KickCard, loadPlayers } from "../server/cards";

const ERRORS: Record<string, string> = {
  name: "Minecraft names are 3 to 16 letters, numbers or underscores.",
  not_found: "Mojang has no Java Edition account with that name.",
  unavailable: "Couldn't reach Mojang. Try again in a minute.",
  taken: "That Minecraft account is already linked to another member.",
};

const PC = { HIGH: ["high", "good"], MID: ["mid", "neutral"], LOW: ["low", "warn"] } as const;
const WIDTHS = ["25%", "20%", "9%", "14%", "11%", "12%", "56px"];
// docs/35: once the site is live the early-access switch changes nothing, so its column goes (it is on Joining → Rules while not live)
const WIDTHS_LIVE = ["29%", "24%", "10%", "16%", "12%", "56px"];

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ error?: string; show?: string; q?: string; msg?: string; detail?: string }> }) {
  const me = await requireAdmin();
  const { error, show, q, msg, detail } = await searchParams;
  const [users, settings, lastRuns, installer, linkRuns, status, players] = await Promise.all([
    db.user.findMany({ orderBy: [{ role: "asc" }, { createdAt: "asc" }], include: { adminLogin: { select: { enabled: true } } } }),
    getSettings(),
    // the installer each member used last: their latest report
    db.installReport.findMany({ where: { mode: { notIn: TEST_MODES } }, orderBy: { at: "desc" }, distinct: ["userId"], select: { userId: true, installerVersion: true, mode: true, outcome: true } }),
    getInstaller(),
    // installer 1.5.6: the latest report that says whether the Play button has a working link on their PC
    db.installReport.findMany({ where: { playLinkMissing: { not: null }, mode: { notIn: TEST_MODES } }, orderBy: { at: "desc" }, distinct: ["userId"], select: { userId: true, playLinkMissing: true } }),
    getStatus(),
    // who of those on the server is in the entrance room: on the server, but not playing
    loadPlayers({ id: me.id, role: "ADMIN" }),
  ]);
  // docs/48 A4: who is playing now, with their ping; they sort first
  const running = status.server === "online";
  const held = new Set((players?.held ?? []).map((h) => h.name.toLowerCase()));
  const playing = new Map((running ? status.online : []).filter((p) => p.uuid && !held.has(p.name.toLowerCase())).map((p) => [p.uuid!, p.ping]));
  const isOn = (u: { mcUuid: string | null }) => u.mcUuid !== null && playing.has(u.mcUuid);
  const current = installer?.current ?? null;
  const noPlayLink = new Set(linkRuns.filter((r) => r.playLinkMissing).map((r) => r.userId));
  const lastInstaller = new Map(lastRuns.map((r) => [r.userId, r.installerVersion]));
  const uninstalled = new Set(lastRuns.filter((r) => !installedNow(r)).map((r) => r.userId));
  const all = users.map((u) => {
    const installerVersion = lastInstaller.get(u.id) ?? null;
    return { ...u, passwordSignIn: Boolean(u.adminLogin?.enabled), installerVersion, installerOutdated: installerVersion !== null && isOutdated(installerVersion, current) };
  });
  const { rows: found, only, query, count } = memberRows(all, show, q);
  const rows = [...found.filter(isOn), ...found.filter((u) => !isOn(u))];
  const early = `While "We're live" is off, a member with early access can download, press Play and join like any player once it is on. Nothing of an admin's.${settings.live ? " The site is live, so it changes nothing right now." : ""}`;
  const showEarly = !settings.live || only === "early" || only === "rest";
  const href = (k: Show) => {
    const sp = new URLSearchParams();
    if (k !== "all") sp.set("show", k);
    if (query) sp.set("q", query);
    const s = sp.toString();
    return s ? `/admin/people?${s}` : "/admin/people";
  };

  const parts = (u: (typeof rows)[number]) => {
    const admin = u.role === "ADMIN";
    return {
      role: <span className="flex min-w-0 items-center gap-1"><Badge tone={admin ? "warn" : "neutral"} className="shrink-0">{u.role.toLowerCase()}</Badge>{u.passwordSignIn && <Badge tone="neutral" className="shrink-0" title="Can also sign in with username, password and an authenticator code">pw</Badge>}{u.outsideAuth && <Badge tone="neutral" className="shrink-0" title="Came in by an invite link: they don't have to be in the Discord server">invited</Badge>}{u.builderTools && <Badge tone="neutral" className="shrink-0" title="Builder tools: may switch Builder mode (creative, WorldEdit) on for themselves (docs/37)">builder</Badge>}{u.maintenanceJoin && <Badge tone="neutral" className="shrink-0" title="Can join during maintenance (docs/48)">maint.</Badge>}</span>,
      minecraft: u.mcUsername ? (
        <span className="flex min-w-0 items-center gap-2"><Clip text={u.mcUsername} mono />{u.verifiedAt && <Badge tone="good" className="shrink-0">verified</Badge>}</span>
      ) : <Badge className="shrink-0">Unlinked</Badge>,
      pc: u.pcTier ? <Badge tone={PC[u.pcTier][1]} className="shrink-0" title={`${PC[u.pcTier][0]} PC${u.pcTierSource === "measured" ? ", measured by the installer" : ", their own pick"}`}>{PC[u.pcTier][0]} PC</Badge> : <span className="text-muted-foreground" title="No tier yet">–</span>,
      installer: uninstalled.has(u.id) ? <span className="text-muted-foreground" title="Their latest report is the uninstaller's">uninstalled</span> : noPlayLink.has(u.id)
        ? <span className="flex min-w-0 items-center gap-1"><InstallerVersion version={u.installerVersion} current={current} outdated={u.installerOutdated} /><Badge tone="warn" className="shrink-0 whitespace-nowrap" title="Setup could not set up the Play button on their PC; it clears when a later run reports it in place">Play button not set up</Badge></span>
        : <InstallerVersion version={u.installerVersion} current={current} outdated={u.installerOutdated} />,
      seen: isOn(u) ? (
        <span className="inline-flex items-center gap-1" data-testid="member-online"><Badge tone="good" className="shrink-0">online</Badge>{playing.get(u.mcUuid!) != null && <Badge tone={pingTone(playing.get(u.mcUuid!)!)} className="shrink-0 tabular-nums">{playing.get(u.mcUuid!)} ms</Badge>}</span>
      ) : <span className="text-muted-foreground" title={u.lastSeenAt ? u.lastSeenAt.toISOString() : "never"}>{timeAgo(u.lastSeenAt)}</span>,
      early: <Switch action={setEarlyAccessAction} fields={{ id: u.id, on: u.earlyAccess ? "0" : "1" }} on={u.earlyAccess} label={`Early access for ${u.displayName}`} disabled={admin} why={admin ? "Admins don't need it" : early} />,
      menu: <MemberMenu u={u} meId={me.id} row={{ running }} />,
    };
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Members</h2>
        <p className="text-sm text-muted-foreground">Minecraft accounts link themselves in game; &quot;Link by name…&quot; in a row&apos;s menu is the fallback.</p>
      </div>
      {error && <Alert tone="error">{ERRORS[error] ?? "Something went wrong."}</Alert>}
      <Flash msg={msg} detail={detail} />
      <div className="flex flex-wrap items-center gap-3">
        <TabStrip label="Filter the members" className="max-w-full">
          {(Object.keys(SHOW) as Show[]).map((k) => <Link key={k} href={href(k)} aria-current={only === k ? "page" : undefined} className={stripLink(only === k)}>{SHOW[k]} ({count[k]})</Link>)}
        </TabStrip>
        <form method="get" action="/admin/people" className="flex min-w-0 flex-1 items-center gap-2" role="search">
          {only !== "all" && <input type="hidden" name="show" value={only} />}
          <input name="q" type="search" defaultValue={query} placeholder="Search by name" aria-label="Search by name" className={cn("h-11 min-w-0 flex-1 min-[800px]:max-w-xs", fieldClasses.replace("w-full ", ""))} />
          <button type="submit" className={buttonClasses("secondary", "sm")}>Search</button>
          {query && <Link href={href(only).replace(/[?&]q=[^&]*/, "").replace(/\?$/, "")} className="whitespace-nowrap text-sm underline">Clear</Link>}
        </form>
      </div>

      {rows.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">Nobody{query ? ` with "${query}" in their name` : ""}.</CardContent></Card>
      ) : (
        <>
          <Card className="hidden min-[800px]:block" data-testid="players-table">
            <CardContent className="p-2">
              <FixedTable label="Members" widths={showEarly ? WIDTHS : WIDTHS_LIVE} head={[{ text: "Member" }, { text: "Minecraft" }, { text: "PC" }, { text: "Installer", title: current ? `The installer each member used last; the site hands out ${current}` : "The installer each member used last" }, { text: "Seen", right: true }, ...(showEarly ? [{ text: "Early access", center: true, title: early }] : []), { text: "Actions", hidden: true }]}>
                {rows.map((u) => {
                  const p = parts(u);
                  return (
                    <tr key={u.id} data-row>
                      <td className={cell}><span className="flex min-w-0 items-center gap-2"><Clip text={u.displayName} className="font-medium" />{p.role}</span></td>
                      <td className={cell}>{p.minecraft}</td>
                      <td className={cell}>{p.pc}</td>
                      <td className={cell}>{p.installer}</td>
                      <td className={`${cell} text-right`}>{p.seen}</td>
                      {showEarly && <td className={`${cell} text-center`}>{p.early}</td>}
                      <td className={menuCell}>{p.menu}</td>
                    </tr>
                  );
                })}
              </FixedTable>
            </CardContent>
          </Card>

          <ul className="space-y-3 min-[800px]:hidden" data-testid="players-cards">
            {rows.map((u) => {
              const p = parts(u);
              return (
                <li key={u.id}>
                  <Card data-row>
                    <CardContent className="p-4">
                      <div className="flex min-w-0 items-center gap-2">
                        <Clip text={u.displayName} className="font-medium" />
                        {p.role}
                        <span className="ml-auto shrink-0">{p.menu}</span>
                      </div>
                      <dl className="mt-2 divide-y text-sm">
                        <Field name="Minecraft">{p.minecraft}</Field>
                        <Field name="PC">{p.pc}</Field>
                        <Field name="Installer">{p.installer}</Field>
                        <Field name="Seen">{p.seen}</Field>
                        {showEarly && <Field name="Early access">{p.early}</Field>}
                      </dl>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <KickCard running={running} />
      <BlockedList />
    </div>
  );
}

/** docs/31 B-37: the Discord accounts "Remove and block" has shut out, each with Unblock. Nothing while there are none. Also on Joining → Rules (docs/35). */
export async function BlockedList() {
  const blocked = await blockedList();
  if (blocked.length === 0) return null;
  return (
    <div data-testid="blocked">
      <h3 className="text-sm font-semibold">Blocked · {blocked.length}</h3>
      <p className="text-sm text-muted-foreground">Removed and blocked: these Discord accounts cannot sign in, even from inside the Discord server.</p>
      <ul className="mt-1 divide-y text-sm">
        {blocked.map((b) => (
          <li key={b.discordId} className="flex flex-wrap items-center gap-2 py-1.5">
            <span className="min-w-0 flex-1">{b.name || "A removed member"} <span className="font-mono text-xs text-muted-foreground">{b.discordId}</span>{b.at && <span className="text-muted-foreground"> · {timeAgo(new Date(b.at))}</span>}</span>
            <form action={unblockAction}>
              <input type="hidden" name="discordId" value={b.discordId} />
              <input type="hidden" name="name" value={b.name} />
              <button type="submit" className={buttonClasses("secondary", "sm")}>Unblock</button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
