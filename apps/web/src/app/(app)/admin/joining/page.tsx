import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { getStatus } from "@/server/status";
import { getSettings } from "@/server/settings";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/admin/parts";
import { asSectionQuery, pickTab, TabbedPage, type PageQuery } from "@/components/tabs";
import { formatDate } from "@/lib/utils";
import SettingsSection from "../settings/section";
import { BlockedList } from "../users/section";
import { setEarlyAccessAction } from "../users/actions";
import { Flash, HeldCard, KickCard, loadHeld, loadPlayers, RoomCard } from "../server/cards";

export const metadata: Metadata = { title: "Joining" };

/**
 * docs/35: who gets in, on one page. It was in five places: Site settings (Launch, Joining), People (early access,
 * outside Discord, blocked), Server (the entrance room), Pack (must vote) and the Control Room (who is held).
 * Nothing here is a second copy of a setting: each card is the same card, or the same switch, as before.
 */
export default async function JoiningAdminPage({ searchParams }: { searchParams: PageQuery }) {
  const admin = await requireAdmin();
  const q = await searchParams;
  const caller = { id: admin.id, role: "ADMIN" as const };
  const heldNow = await loadHeld(caller);
  const tabs = [{ key: "waiting", label: "Who's waiting", count: heldNow?.held.length || null }, { key: "rules", label: "Rules" }, { key: "room", label: "Entrance room" }];
  const tab = pickTab(q.tab, tabs);
  const flash = <Flash msg={typeof q.msg === "string" ? q.msg : undefined} detail={typeof q.detail === "string" ? q.detail : undefined} />;

  let body: React.ReactNode;
  if (tab === "waiting") {
    const [status, turned] = await Promise.all([
      getStatus(),
      db.event.findMany({ where: { kind: "JOIN_BLOCKED" }, orderBy: { at: "desc" }, take: 10, select: { id: true, at: true, message: true } }),
    ]);
    body = (
      <div className="space-y-4">
        <AutoRefresh seconds={15} />
        {flash}
        {heldNow === null ? (
          <Card><CardContent className="p-5 text-sm text-muted-foreground">The portal&apos;s back end did not answer, so who is in the entrance room is not known right now.</CardContent></Card>
        ) : heldNow.held.length === 0 ? (
          <Card data-testid="held-none"><CardContent className="p-5 text-sm text-muted-foreground">Nobody is waiting in the entrance room.</CardContent></Card>
        ) : (
          <HeldCard held={heldNow.held} back="/admin/joining" />
        )}
        <Card data-testid="turned-away">
          <CardHeader>
            <CardTitle>Held at the door lately</CardTitle>
            <CardDescription>The last ten times the door kept somebody in the entrance room, and why. <Link href="/activity" className="underline">Everything, in Activity</Link>.</CardDescription>
          </CardHeader>
          <CardContent>
            {turned.length === 0 ? <p className="text-sm text-muted-foreground">Nobody yet.</p> : (
              <ul className="divide-y text-sm">
                {turned.map((e) => <li key={String(e.id)} className="py-1.5"><span className="block text-xs text-muted-foreground">{formatDate(e.at)}</span>{e.message}</li>)}
              </ul>
            )}
          </CardContent>
        </Card>
        <KickCard running={status.server === "online"} />
      </div>
    );
  } else if (tab === "rules") {
    const [settings, vote, polls, members, outsideAll] = await Promise.all([
      getSettings(),
      db.vote.findFirst({ where: { status: "OPEN" }, select: { title: true, mustVote: true } }),
      db.poll.findMany({ where: { status: "OPEN", mustVote: true }, orderBy: { openedAt: "asc" }, select: { id: true, question: true } }),
      db.user.findMany({ where: { role: "PLAYER" }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true, earlyAccess: true } }),
      db.user.findMany({ where: { outsideAuth: true }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true } }),
    ]);
    const outside = outsideAll;
    const early = "While \"We're live\" is off, a member with early access can download, press Play and join like any player once it is on.";
    body = (
      <div className="space-y-4">
        <SettingsSection searchParams={asSectionQuery(q)} cards={["launch", "joining"]} />
        <Card data-testid="must-vote">
          <CardHeader>
            <CardTitle>Vote first</CardTitle>
            <CardDescription>A vote marked &quot;must vote before playing&quot; holds whoever joins without having voted. Somebody already playing is never held; admins are asked but never held.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {!vote?.mustVote && polls.length === 0 && <p className="text-muted-foreground">No open vote holds anybody right now.</p>}
            {vote?.mustVote && <p><Badge tone="warn">must vote</Badge> The mod vote &quot;{vote.title}&quot;. Change it on <Link href="/admin/pack?tab=modvote" className="underline">Modpack → Mod vote</Link>.</p>}
            {vote && !vote.mustVote && <p className="text-muted-foreground">The mod vote &quot;{vote.title}&quot; is open and optional. Make it a must on <Link href="/admin/pack?tab=modvote" className="underline">Modpack → Mod vote</Link>.</p>}
            {polls.map((p) => <p key={p.id}><Badge tone="warn">must vote</Badge> The poll &quot;{p.question}&quot;. Close it on <Link href="/admin/votes" className="underline">Votes</Link>.</p>)}
          </CardContent>
        </Card>
        {!settings.live && (
          <Card data-testid="early-access">
            <CardHeader>
              <CardTitle>Early access · {members.filter((m) => m.earlyAccess).length}</CardTitle>
              <CardDescription>{early} Shown only while the site is not live. Admins don&apos;t need it.</CardDescription>
            </CardHeader>
            <CardContent>
              {members.length === 0 ? <p className="text-sm text-muted-foreground">No players yet.</p> : (
                <ul className="divide-y text-sm">
                  {members.map((m) => (
                    <li key={m.id} className="flex items-center gap-3 py-1.5">
                      <span className="min-w-0 flex-1 truncate">{m.displayName}</span>
                      <Switch action={setEarlyAccessAction} fields={{ id: m.id, on: m.earlyAccess ? "0" : "1" }} on={m.earlyAccess} label={`Early access for ${m.displayName}`} why={early} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
        <Card data-testid="outside-discord">
          <CardHeader>
            <CardTitle>In without the Discord server · {outside.length}</CardTitle>
            <CardDescription>Members the Discord server rule is not applied to: whoever came in by an invite link, or was put on the list by hand. Put somebody on it or take them off in their row&apos;s menu on <Link href="/admin/people?show=outside" className="underline">People → Members</Link>; a new invite is made on <Link href="/admin/people?tab=invites" className="underline">People → Invites</Link>.</CardDescription>
          </CardHeader>
          <CardContent>
            {outside.length === 0 ? <p className="text-sm text-muted-foreground">Nobody. Everyone has to be in the Discord server.</p> : <p className="text-sm">{outside.map((m) => m.displayName).join(", ")}</p>}
          </CardContent>
        </Card>
        <BlockedList />
      </div>
    );
  } else {
    const [status, players] = await Promise.all([getStatus(), loadPlayers(caller)]);
    body = <div className="space-y-4">{flash}<RoomCard players={players} running={status.server === "online"} /></div>;
  }

  return (
    <TabbedPage title="Joining" intro="Who gets into the game: who is waiting at the door, the rules the door goes by, and the entrance room itself." base="/admin/joining" tabs={tabs} current={tab}>
      {body}
    </TabbedPage>
  );
}
