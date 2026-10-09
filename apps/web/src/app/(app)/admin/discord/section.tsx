import { requireAdmin } from "@/server/auth/session";
import { getSection } from "@/server/site-settings";
import { apiFetch } from "@/server/api-client";
import { ukShort } from "@/lib/uk-time";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { pauseDiscordAction, saveDiscordAction, saveDiscordBotAction, testDiscordAction } from "./actions";
import { BOT_SWITCHES, SWITCHES, UPDATES } from "./switches";
import { Check } from "@/components/ui/check";
import { cn } from "@/lib/utils";
import { fieldClasses, Input, Label } from "@/components/ui/input";
import { saveBrandingAction } from "../branding/actions";

type LastSend = { at: string; what: string; ok: boolean; error?: string } | null;
type Hook = ({ state: "unset" } | { state: "refused" } | { state: "unreachable"; error: string } | { state: "ok"; name: string; channel: string | null } | { state: "failing"; name: string; channel: string | null; error: string }) & { last?: LastSend };
type Channel = { id: string; name: string };
type BotView =
  | { state: "unset" | "no_guild" }
  | { state: "connecting" | "on" | "reconnecting" | "refused" | "stopped"; tag: string | null; refused: string | null; missingIntents: boolean; inGuild: boolean; textChannels: Channel[]; forums: Channel[]; invite: string | null };
// planner 2026-10-09: the Minecraft role on everyone who plays (api discord/role.ts)
type RoleView = { state: "off" } | { state: "on"; holders: number | null; lastRunAt: string | null; lastError: string | null };
type Overview = { feed: Hook; admin: Hook; updates?: Hook; bot?: BotView; role?: RoleView; recent: Array<{ at: string; channel: "feed" | "admin" | "updates"; what: string; ok: boolean; error?: string }> };

/** docs/22 §7: the bot's state in one line. */
function botLine(b: BotView | undefined): React.ReactNode {
  if (!b || b.state === "unset") return <>No bot token set. Ask the VPS session to add <span className="font-mono">DISCORD_BOT_TOKEN</span>.</>;
  if (b.state === "no_guild") return <>The bot has a token but no server: <span className="font-mono">DISCORD_GUILD_ID</span> is not set.</>;
  if (b.state === "refused") return <span className="text-danger">{b.refused === "intents" ? "Switch on Message Content Intent and Server Members Intent in the Developer Portal (Bot page)." : "Discord refused the token."}</span>;
  if (b.state !== "on") return <>Connecting to Discord…</>;
  return <>The bot is connected as {b.tag ?? "the bot"}{b.missingIntents ? <span className="text-danger">. Switch on Message Content Intent and Server Members Intent in the Developer Portal: chat from Discord and leaving the server are not seen without them</span> : null}{b.inGuild ? "." : ", but it is not in the server yet."}</>;
}

function where(h: Hook, env: string): React.ReactNode {
  switch (h.state) {
    case "unset":
      return <>No webhook set. Ask the VPS session to add <span className="font-mono">{env}</span>.</>;
    case "refused":
      return <span className="text-danger">Discord refused the webhook.</span>;
    case "unreachable":
      return <>Discord could not be asked just now ({h.error}).</>;
    case "ok":
      return <>{h.channel ? <>Posting to #{h.channel}</> : <>Posting through the webhook &quot;{h.name}&quot;</>}{h.last ? <span className="text-muted-foreground">. Last post {ukShort(new Date(h.last.at))} ({h.last.what}): taken</span> : null}</>;
    case "failing":
      return <span className="text-danger" data-testid="discord-failing">The last post {h.channel ? <>to #{h.channel} </> : null}did not go through{h.last ? <> ({ukShort(new Date(h.last.at))}, {h.last.what})</> : null}: {h.error}</span>;
  }
}

const SAVED: Record<string, string> = { discord: "Saved.", paused: "The feed is paused: nothing is posted until you switch it back on.", resumed: "The feed is on again. What happened while it was paused is not posted." };

/** docs/21 §7, and docs/35 for where it sits: Admin → Discord, one tab for each of its parts. */
export default async function DiscordSection({ searchParams, tab }: { searchParams: Promise<{ saved?: string; error?: string; detail?: string; note?: string; tested?: string; testError?: string }>; tab: "connection" | "bot" | "posted" }) {
  const admin = await requireAdmin();
  const [q, sw, privacy, branding, overview] = await Promise.all([
    searchParams,
    getSection("discord"),
    getSection("privacy"),
    getSection("branding"),
    apiFetch<Overview>("/discord", { caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 12_000 }).catch(() => null),
  ]);
  const feedSet = overview ? overview.feed.state !== "unset" : false;
  const adminSet = overview ? overview.admin.state !== "unset" : false;
  const twoChannels = Boolean(overview && ((overview.updates && overview.updates.state !== "unset") || (overview.bot && overview.bot.state !== "unset" && overview.bot.state !== "no_guild")));
  return (
    <div className="space-y-4">
      {q.saved && <Alert tone="success">{SAVED[q.saved] ?? "Saved."} {q.note}</Alert>}
      {/* the invite link is saved with the branding, which puts its reason in `error` itself */}
      {q.error && <Alert tone="error">Not saved. {q.detail ?? (q.error === "discord" ? "" : q.error)}</Alert>}
      {q.tested && <Alert tone="success">Discord took the test message. Look in the {q.tested === "admin" ? "admin channel" : q.tested === "updates" ? "forum season-updates (a new post)" : "chat channel"}.</Alert>}
      {q.testError && <Alert tone="error">The test message did not arrive: {q.testError}</Alert>}
      {tab === "connection" && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Discord {sw.paused ? <Badge tone="warn">paused</Badge> : overview?.feed.state === "ok" ? <Badge tone="good">on</Badge> : overview?.feed.state === "failing" ? <Badge tone="warn">failing</Badge> : <Badge>off</Badge>}
          </CardTitle>
          <CardDescription>
            The server&apos;s life in one Discord channel: votes, deaths, joins, news and the season. It only posts, one way; nobody is pinged except by the vote reminder. Changes take effect within half a minute.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!overview ? (
            <Alert tone="error">The portal&apos;s back end did not answer, so the webhooks&apos; state is unknown.</Alert>
          ) : (
            <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="font-medium">#game-chat</dt>
              <dd>{where(overview.feed, "DISCORD_WEBHOOK_FEED")}</dd>
              <dt className="font-medium">season-updates</dt>
              <dd>{!overview.updates || overview.updates.state === "unset" ? <>No webhook set{overview.bot && overview.bot.state !== "unset" ? <>: votes, news and the season are not posted. Ask the VPS session to add <span className="font-mono">DISCORD_WEBHOOK_UPDATES</span>.</> : <> (optional): votes and news go to #game-chat as before.</>}</> : where(overview.updates, "DISCORD_WEBHOOK_UPDATES")}</dd>
              <dt className="font-medium">Admin channel</dt>
              <dd>{overview.admin.state === "unset" ? <>None. Pick a private channel as the admin channel on the Channels &amp; bot tab; crashes and problems are not posted until then.</> : where(overview.admin, "DISCORD_WEBHOOK_ADMIN")}</dd>
              <dt className="font-medium">Minecraft role</dt>
              <dd>
                {!overview.role || overview.role.state === "off" ? (
                  <>Off. Ask the VPS session to add <span className="font-mono">DISCORD_PLAYER_ROLE_ID</span>; then everyone who has linked their game gets the role.</>
                ) : (
                  <>
                    On: {overview.role.holders === null ? "not checked yet" : `${overview.role.holders} ${overview.role.holders === 1 ? "member holds" : "members hold"} it`}
                    {overview.role.lastRunAt ? `, checked ${new Date(overview.role.lastRunAt).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" })}` : ""}.
                    {overview.role.lastError && <span className="block text-danger">{overview.role.lastError}</span>}
                  </>
                )}
              </dd>
            </dl>
          )}
          <form action={testDiscordAction.bind(null, "feed")} className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="secondary" disabled={!feedSet}>Send a test message</Button>
            <Button type="submit" size="sm" variant="secondary" disabled={!overview?.updates || overview.updates.state === "unset"} formAction={testDiscordAction.bind(null, "updates")}>Test season-updates</Button>
            <Button type="submit" size="sm" variant="secondary" disabled={!adminSet} formAction={testDiscordAction.bind(null, "admin")}>Test the admin channel</Button>
            {sw.paused ? (
              <Button type="submit" size="sm" formAction={pauseDiscordAction.bind(null, false)}>Switch the feed back on</Button>
            ) : (
              <Button type="submit" size="sm" variant="ghost" formAction={pauseDiscordAction.bind(null, true)}>Pause the feed</Button>
            )}
          </form>
        </CardContent>
      </Card>
      )}
      {tab === "connection" && (
      <Card data-testid="discord-invite">
        <CardHeader>
          <CardTitle>Invite link</CardTitle>
          <CardDescription>The link to the group&apos;s Discord server that the site shows: in the footer and wherever somebody is told to join it. Empty: no link is shown.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveBrandingAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="from" value="invite" />
            <div className="min-w-0 flex-1 sm:max-w-md"><Label htmlFor="discordInvite">Discord invite link</Label><Input id="discordInvite" name="discordInvite" type="url" defaultValue={branding.discordInvite} maxLength={200} placeholder="https://discord.gg/…" /></div>
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>
      )}
      {tab === "bot" && (
      <Card>
        <CardHeader>
          <CardTitle>Bot</CardTitle>
          <CardDescription>Vote buttons, chat both ways, slash commands, and leaving the Discord server is noticed within seconds. Who someone is in Discord is who they are on the portal; Discord roles give nothing here.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">{botLine(overview?.bot)}</p>
          {overview?.bot && "invite" in overview.bot && overview.bot.invite && !overview.bot.inGuild && (
            <a href={overview.bot.invite} target="_blank" rel="noreferrer" className={buttonClasses("secondary", "sm")}>Add the bot to the server</a>
          )}
          {overview?.bot && "inGuild" in overview.bot && overview.bot.inGuild && (
            <form action={saveDiscordBotAction} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm"><span className="block font-medium">Chat channel</span>
                  <select name="chatChannel" defaultValue={sw.chatChannel} className={cn("mt-1 h-11", fieldClasses)}>
                    <option value="">None: no chat relay</option>
                    {overview.bot.textChannels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
                  </select>
                </label>
                <label className="text-sm"><span className="block font-medium">Updates forum</span>
                  <select name="updatesForum" defaultValue={sw.updatesForum} className={cn("mt-1 h-11", fieldClasses)}>
                    <option value="">None: votes without buttons</option>
                    {overview.bot.forums.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label className="text-sm sm:col-span-2"><span className="block font-medium">Admin channel</span>
                  <select name="adminChannel" defaultValue={sw.adminChannel} className={cn("mt-1 h-11", fieldClasses)}>
                    <option value="">None: crashes and problems are not posted</option>
                    {overview.bot.textChannels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
                  </select>
                  <span className="mt-1 block text-muted-foreground">Crashes and problems, for admins only: pick a private channel, and let Deepslate Works into it (Edit channel → Permissions → add the bot), or the test says it cannot write there.</span>
                </label>
              </div>
              {!privacy.chat && <p className="text-sm text-muted-foreground">Chat relay is off because chat logging is off (Site → Privacy &amp; data).</p>}
              {BOT_SWITCHES.map((s) => (
                <label key={s.key} className="flex cursor-pointer items-start gap-3 rounded-[4px] border p-3">
                  <Check className="mt-1" type="checkbox" name={s.key} defaultChecked={sw[s.key]} />
                  <span><span className="block font-medium">{s.title}</span><span className="block text-sm text-muted-foreground">{s.example}</span></span>
                </label>
              ))}
              <Button type="submit">Save</Button>
            </form>
          )}
        </CardContent>
      </Card>
      )}
      {tab === "posted" && (
      <Card>
        <CardHeader>
          <CardTitle>What is posted</CardTitle>
          <CardDescription>Only what players can see on the Activity page goes to the feed. Players who have not linked their Minecraft account are never named.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveDiscordAction} className="space-y-3">
            {SWITCHES.map((s) => (
              <label key={s.key} className="flex cursor-pointer items-start gap-3 rounded-[4px] border p-3">
                <Check className="mt-1" type="checkbox" name={s.key} defaultChecked={sw[s.key]} />
                <span><span className="block font-medium">{s.title} <span className="font-normal text-muted-foreground">{s.key === "problems" ? "· to the admin channel" : twoChannels && UPDATES.has(s.key) ? "· to season-updates" : "· to #game-chat"}</span></span><span className="block text-sm text-muted-foreground">{s.example}</span></span>
              </label>
            ))}
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>
      )}
      {tab === "connection" && overview && overview.recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Last messages sent</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {overview.recent.map((r, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                  <span className="w-28 shrink-0 text-muted-foreground">{ukShort(new Date(r.at))}</span>
                  <span className="w-28 shrink-0">{r.channel === "admin" ? "admin" : r.channel === "updates" ? "season-updates" : "#game-chat"}</span>
                  <span className="flex-1">{r.what}</span>
                  {r.ok ? <Badge tone="good">taken</Badge> : <Badge tone="bad" title={r.error}>not taken</Badge>}
                  {!r.ok && r.error && <span className="basis-full text-xs text-muted-foreground">{r.error}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
