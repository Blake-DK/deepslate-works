import Link from "next/link";
import { db } from "@/server/db";
import { requireAdmin } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { timeAgo } from "@/lib/utils";
import { memberRows, SHOW, type Show } from "@/lib/admin-lists";
import { cell, Clip, Field, FixedTable, menuCell, Switch } from "@/components/admin/parts";
import { getInstaller } from "@/server/modpack/lock";
import { isOutdated } from "@/lib/installer-version";
import { InstallerVersion } from "@/components/admin/installer-version";
import { setEarlyAccessAction } from "./actions";
import { MemberMenu } from "./member-menu";

const ERRORS: Record<string, string> = {
  name: "Minecraft names are 3 to 16 letters, numbers or underscores.",
  not_found: "Mojang has no Java Edition account with that name.",
  unavailable: "Couldn't reach Mojang. Try again in a minute.",
  taken: "That Minecraft account is already linked to another member.",
};

const PC = { HIGH: ["high", "good"], MID: ["mid", "neutral"], LOW: ["low", "warn"] } as const;
const WIDTHS = ["25%", "20%", "9%", "14%", "11%", "12%", "56px"];

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ error?: string; show?: string; q?: string }> }) {
  const me = await requireAdmin();
  const { error, show, q } = await searchParams;
  const [users, settings, lastRuns, installer] = await Promise.all([
    db.user.findMany({ orderBy: [{ role: "asc" }, { createdAt: "asc" }] }),
    getSettings(),
    // the installer each member used last: their latest report
    db.installReport.findMany({ orderBy: { at: "desc" }, distinct: ["userId"], select: { userId: true, installerVersion: true } }),
    getInstaller(),
  ]);
  const current = installer?.version ?? null;
  const lastInstaller = new Map(lastRuns.map((r) => [r.userId, r.installerVersion]));
  const all = users.map((u) => {
    const installerVersion = lastInstaller.get(u.id) ?? null;
    return { ...u, installerVersion, installerOutdated: installerVersion !== null && isOutdated(installerVersion, current) };
  });
  const { rows, only, query, count } = memberRows(all, show, q);
  const early = `While "We're live" is off, a member with early access can download, press Play and join like any player once it is on. Nothing of an admin's.${settings.live ? " The site is live, so it changes nothing right now." : ""}`;
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
      role: <Badge tone={admin ? "warn" : "neutral"} className="shrink-0">{u.role.toLowerCase()}</Badge>,
      minecraft: u.mcUsername ? (
        <span className="flex min-w-0 items-center gap-2"><Clip text={u.mcUsername} mono />{u.verifiedAt && <Badge tone="good" className="shrink-0">verified</Badge>}</span>
      ) : <Badge className="shrink-0">Unlinked</Badge>,
      pc: u.pcTier ? <Badge tone={PC[u.pcTier][1]} className="shrink-0" title={`${PC[u.pcTier][0]} PC${u.pcTierSource === "measured" ? ", measured by the installer" : ", their own pick"}`}>{PC[u.pcTier][0]} PC</Badge> : <span className="text-muted-foreground" title="No tier yet">–</span>,
      installer: <InstallerVersion version={u.installerVersion} current={current} outdated={u.installerOutdated} />,
      seen: <span className="text-muted-foreground" title={u.lastSeenAt ? u.lastSeenAt.toISOString() : "never"}>{timeAgo(u.lastSeenAt)}</span>,
      early: <Switch action={setEarlyAccessAction} fields={{ id: u.id, on: u.earlyAccess ? "0" : "1" }} on={u.earlyAccess} label={`Early access for ${u.displayName}`} disabled={admin} why={admin ? "Admins don't need it" : early} />,
      menu: <MemberMenu u={u} meId={me.id} />,
    };
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Players</h2>
        <p className="text-sm text-muted-foreground">Minecraft accounts link themselves in game; &quot;Link by name…&quot; in a row&apos;s menu is the fallback.</p>
      </div>
      {error && <Alert tone="error">{ERRORS[error] ?? "Something went wrong."}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <nav className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-sm" aria-label="Filter the players">
          {(Object.keys(SHOW) as Show[]).map((k) => <Link key={k} href={href(k)} aria-current={only === k ? "page" : undefined} className={`whitespace-nowrap rounded-md px-3 py-1.5 ${only === k ? "bg-card font-medium shadow-sm" : "hover:bg-card"}`}>{SHOW[k]} ({count[k]})</Link>)}
        </nav>
        <form method="get" action="/admin/people" className="flex min-w-0 flex-1 items-center gap-2" role="search">
          {only !== "all" && <input type="hidden" name="show" value={only} />}
          <input name="q" type="search" defaultValue={query} placeholder="Search by name" aria-label="Search by name" className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-[800px]:max-w-xs" />
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
              <FixedTable label="Players" widths={WIDTHS} head={[{ text: "Member" }, { text: "Minecraft" }, { text: "PC" }, { text: "Installer", title: current ? `The installer each member used last; the site hands out ${current}` : "The installer each member used last" }, { text: "Seen", right: true }, { text: "Early access", center: true, title: early }, { text: "Actions", hidden: true }]}>
                {rows.map((u) => {
                  const p = parts(u);
                  return (
                    <tr key={u.id} data-row>
                      <td className={cell}><span className="flex min-w-0 items-center gap-2"><Clip text={u.displayName} className="font-medium" />{p.role}</span></td>
                      <td className={cell}>{p.minecraft}</td>
                      <td className={cell}>{p.pc}</td>
                      <td className={cell}>{p.installer}</td>
                      <td className={`${cell} text-right`}>{p.seen}</td>
                      <td className={`${cell} text-center`}>{p.early}</td>
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
                        <Field name="Early access">{p.early}</Field>
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
