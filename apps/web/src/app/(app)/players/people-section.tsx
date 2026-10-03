import { db } from "@/server/db";
import { getStatus } from "@/server/status";
import { timeAgo } from "@/lib/series";
import { AutoRefresh } from "@/components/auto-refresh";
import { PlayerHead } from "@/components/server/player-head";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

const TIER: Record<string, string> = { LOW: "Older PC", MID: "Decent PC", HIGH: "Gaming PC" };

export default async function PlayersPage() {
  const [users, status, played] = await Promise.all([
    // Nothing sensitive leaves the database: no emails, no Discord ids, no addresses.
    db.user.findMany({ select: { id: true, displayName: true, mcUsername: true, mcUuid: true, pcTier: true, role: true } }),
    getStatus(),
    db.session.groupBy({ by: ["mcUuid"], _max: { joinedAt: true, leftAt: true } }),
  ]);
  // "Last played" is about the game, not the website: the end of their latest session (or its start, if it is still open).
  const lastPlayed = new Map(played.map((p) => [p.mcUuid, p._max.leftAt && p._max.joinedAt && p._max.leftAt > p._max.joinedAt ? p._max.leftAt : p._max.joinedAt]));
  const onlineNames = new Set((status?.online ?? []).map((p) => p.name.toLowerCase()));
  const onlineUuids = new Set((status?.online ?? []).map((p) => p.uuid).filter((u): u is string => Boolean(u)));
  const rows = users
    .map((u) => ({ ...u, lastPlayed: (u.mcUuid && lastPlayed.get(u.mcUuid)) || null, online: Boolean((u.mcUuid && onlineUuids.has(u.mcUuid)) || (u.mcUsername && onlineNames.has(u.mcUsername.toLowerCase()))) }))
    .sort((a, b) => Number(b.online) - Number(a.online) || (b.lastPlayed?.getTime() ?? 0) - (a.lastPlayed?.getTime() ?? 0) || a.displayName.localeCompare(b.displayName));
  const known = new Set(rows.filter((r) => r.online && r.mcUsername).map((r) => r.mcUsername!.toLowerCase()));
  const guests = (status?.online ?? []).filter((p) => !known.has(p.name.toLowerCase()) && !rows.some((r) => r.mcUuid && r.mcUuid === p.uuid));
  const now = new Date();
  return (
    <div className="space-y-4">
      <AutoRefresh seconds={15} />
      <div>
        <h2 className="text-xl font-semibold">Players</h2>
        <p className="text-muted-foreground">{rows.length} in the group, {rows.filter((r) => r.online).length + guests.length} playing right now.</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {rows.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-4 py-3">
                <PlayerHead uuid={u.mcUuid} name={u.mcUsername} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{u.mcUuid ? <Link href={`/players/${u.mcUuid}`} className="hover:underline">{u.displayName}</Link> : u.displayName} {u.role === "ADMIN" && <Badge className="ml-1">Admin</Badge>}</p>
                  <p className="truncate text-sm text-muted-foreground">{u.mcUsername ? <span className="font-mono">{u.mcUsername}</span> : "No Minecraft account linked yet"}{u.pcTier && <> · {TIER[u.pcTier]}</>}</p>
                </div>
                <div className="text-right text-sm">
                  {u.online ? <Badge tone="good">Playing</Badge> : <span className="text-muted-foreground">{u.lastPlayed ? `Last played ${timeAgo(u.lastPlayed, now)}` : "Hasn't played yet"}</span>}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {guests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>On the server, not linked yet</CardTitle>
            <CardDescription>These Minecraft accounts are connected but haven&apos;t been linked to anyone in the group. They wait in the entrance room until they do.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {guests.map((g) => <li key={g.name} className="flex items-center gap-2 rounded-[3px] border bg-card-2 py-1 pl-1 pr-3 text-sm"><PlayerHead uuid={g.uuid} name={g.name} size={24} /><span className="font-mono">{g.name}</span></li>)}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
