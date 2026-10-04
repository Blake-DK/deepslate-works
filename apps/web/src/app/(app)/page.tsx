import Link from "next/link";
import { headers } from "next/headers";
import { requireOnboardedUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/env";
import { getOpenVote } from "@/server/vote/votes";
import { formatDate } from "@/lib/utils";
import { timeAgo } from "@/lib/series";
import { canSeeServer, getSettings } from "@/server/settings";
import { getStatus, playersLast24h } from "@/server/status";
import { getAnnouncements } from "@/server/announcements";
import { LaunchBanner } from "@/components/launch-banner";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusCard } from "@/components/server/status-card";
import { MapEmbed } from "@/components/server/map-embed";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { isWindows, WINDOWS_ONLY } from "@/lib/platform";
import { getPlayInfo } from "@/server/play";
import { PlayButton } from "@/components/server/play-button";
import { VoteBanner } from "@/components/polls/vote-banner";
import { pendingFor } from "@/server/polls";
import { joinLine } from "@/lib/play";
import { clock } from "@/lib/utils";
import { getBranding } from "@/server/branding";
import { getSeasonCurrent, lineFor } from "@/server/season";

export default async function HomePage() {
  const user = await requireOnboardedUser();
  const brand = await getBranding();
  const [members, openVote, settings, status, series, news, play, agent, pending, season] = await Promise.all([
    db.user.count(),
    getOpenVote(),
    getSettings(),
    getStatus(),
    playersLast24h().catch(() => [] as Array<number | null>),
    getAnnouncements(3),
    getPlayInfo(user),
    headers().then((h) => h.get("user-agent")),
    pendingFor({ id: user.id, role: user.role }),
    getSeasonCurrent().then(lineFor).catch(() => null),
  ]);
  const showServer = canSeeServer(user, settings);
  const mapUp = Boolean(env.MAP_URL) && status.server === "online";
  return (
    <div className="space-y-6">
      <AutoRefresh seconds={10} />
      <div>
        <p className="text-sm font-medium text-primary" data-testid="tagline">{brand.name}{brand.tagline && <> · {brand.tagline}</>}</p>
        <h1 className="text-2xl font-semibold">Welcome back, {user.displayName}</h1>
        <p className="text-muted-foreground">{user.mcUsername ? <>Linked to Minecraft account <span className="font-mono">{user.mcUsername}</span>.</> : <>Your Minecraft account gets linked the first time you join the server.</>} {members} {members === 1 ? "person" : "people"} in the group so far.</p>
      </div>
      {!settings.live && !(user.earlyAccess && user.role !== "ADMIN") && <LaunchBanner launchAt={settings.launchAt} admin={user.role === "ADMIN"} />}
      <VoteBanner pending={pending} />
      {season && <p className="rounded-[4px] border bg-card px-4 py-3 text-sm" data-testid="season-line"><Link href="/season" className="font-medium text-primary hover:underline">Season</Link> · {season}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatusCard status={status} series={series} address={showServer ? env.SERVER_ADDRESS : null} admin={user.role === "ADMIN"} />
        <div className="space-y-4">
          {showServer && (
            <Card data-testid="play-card">
              <CardHeader>
                <CardTitle>Play</CardTitle>
                {isWindows(agent) && <CardDescription>Checks for mod updates, then opens the Minecraft Launcher on {play.name}.</CardDescription>}
              </CardHeader>
              <CardContent>
                {isWindows(agent)
                  ? <PlayButton download={play.download} name={play.name} current={play.current} ready={play.ready} last={play.last ? { version: play.last.version, on: formatDate(play.last.at) } : null} update={play.update} join={joinLine(play.join ? (play.join.ok ? { ok: true, time: clock(play.join.until) } : play.join) : null, !play.tooOld)}  server={play.server} wake={play.wake} installed={play.installed} tooOld={play.tooOld} voteFirst={pending.list.length > 0} />
                  : <p className="text-sm text-muted-foreground">{WINDOWS_ONLY(play.name)}</p>}
              </CardContent>
            </Card>
          )}
          <Card className={openVote ? "border-2 border-primary" : undefined}>
            <CardHeader>
              <CardTitle>{openVote ? `Vote open: ${openVote.title}` : "The mod list"}</CardTitle>
              <CardDescription>{openVote ? `Tick the mods you want${openVote.closesAt ? ` before ${formatDate(openVote.closesAt)}` : ""}. Takes two minutes on a phone.` : "Read up on every mod, with videos and wiki links. The season vote will show up here when it opens."}</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              {openVote && <Link href="/pack?tab=vote" className={buttonClasses("copper", "sm")}>Vote now</Link>}
              <Link href="/pack" className={buttonClasses("secondary", "sm")}>Mod list</Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>News</CardTitle>
              {news.length === 0 && <CardDescription>Nothing announced yet.</CardDescription>}
            </CardHeader>
            {news.length > 0 && (
              <CardContent>
                <ul className="space-y-3">
                  {news.map((n) => (
                    <li key={n.id} className="text-sm">
                      <p className="whitespace-pre-line">{n.pinned && <Badge tone="warn" className="mr-2">Pinned</Badge>}{n.body}</p>
                      {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded picture, served by our own route */}
                      {n.image && <a href={n.image} target="_blank" rel="noreferrer" className="mt-2 block"><img src={n.image} alt="" loading="lazy" className="max-h-72 w-full rounded-[4px] border object-cover" data-testid="news-image" /></a>}
                      <p className="text-xs text-muted-foreground">{n.author} · {timeAgo(n.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
      {env.MAP_URL && (
        <Card>
          <CardHeader>
            <CardTitle>Live map</CardTitle>
            <CardDescription>{mapUp ? "The world in 3D, with everyone who is online on it." : "The map comes from the game server, so it is only there while the server is running."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {mapUp && <MapEmbed url={env.MAP_URL} startOpen={user.pcTier !== "LOW"} />}
            <Link href="/map" className={buttonClasses(mapUp ? "primary" : "secondary", "lg")}>Open live map</Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
