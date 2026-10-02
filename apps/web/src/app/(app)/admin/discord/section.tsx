import { requireAdmin } from "@/server/auth/session";
import { getSection } from "@/server/site-settings";
import { apiFetch } from "@/server/api-client";
import { ukShort } from "@/lib/uk-time";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { pauseDiscordAction, saveDiscordAction, testDiscordAction } from "./actions";
import { SWITCHES } from "./switches";

type Hook = { state: "unset" } | { state: "refused" } | { state: "unreachable"; error: string } | { state: "ok"; name: string; channel: string | null };
type Overview = { feed: Hook; admin: Hook; recent: Array<{ at: string; channel: "feed" | "admin"; what: string; ok: boolean; error?: string }> };

function where(h: Hook, env: string): React.ReactNode {
  switch (h.state) {
    case "unset":
      return <>No webhook set. Ask the VPS session to add <span className="font-mono">{env}</span>.</>;
    case "refused":
      return <span className="text-danger">Discord refused the webhook.</span>;
    case "unreachable":
      return <>Discord could not be asked just now ({h.error}).</>;
    case "ok":
      return h.channel ? <>Posting to #{h.channel}</> : <>Posting through the webhook &quot;{h.name}&quot;</>;
  }
}

const SAVED: Record<string, string> = { discord: "Saved.", paused: "The feed is paused: nothing is posted until you switch it back on.", resumed: "The feed is on again. What happened while it was paused is not posted." };

/** docs/21 §7: Admin → Site settings → Discord. */
export default async function DiscordSection({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; detail?: string; tested?: string; testError?: string }> }) {
  const admin = await requireAdmin();
  const [q, sw, overview] = await Promise.all([
    searchParams,
    getSection("discord"),
    apiFetch<Overview>("/discord", { caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 12_000 }).catch(() => null),
  ]);
  const feedSet = overview ? overview.feed.state !== "unset" : false;
  const adminSet = overview ? overview.admin.state !== "unset" : false;
  return (
    <div className="space-y-4">
      {q.saved && <Alert tone="success">{SAVED[q.saved] ?? "Saved."}</Alert>}
      {q.error && <Alert tone="error">Not saved. {q.detail}</Alert>}
      {q.tested && <Alert tone="success">Discord took the test message. Look in the {q.tested === "admin" ? "admin channel" : "feed's channel"}.</Alert>}
      {q.testError && <Alert tone="error">The test message did not arrive: {q.testError}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Discord {sw.paused ? <Badge tone="warn">paused</Badge> : overview?.feed.state === "ok" ? <Badge tone="good">on</Badge> : <Badge>off</Badge>}
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
              <dt className="font-medium">Feed</dt>
              <dd>{where(overview.feed, "DISCORD_WEBHOOK_FEED")}</dd>
              <dt className="font-medium">Admin channel</dt>
              <dd>{overview.admin.state === "unset" ? <>None (optional). Crashes and problems are then not posted anywhere.</> : where(overview.admin, "DISCORD_WEBHOOK_ADMIN")}</dd>
            </dl>
          )}
          <form action={testDiscordAction.bind(null, "feed")} className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="secondary" disabled={!feedSet}>Send a test message</Button>
            <Button type="submit" size="sm" variant="secondary" disabled={!adminSet} formAction={testDiscordAction.bind(null, "admin")}>Test the admin channel</Button>
            {sw.paused ? (
              <Button type="submit" size="sm" formAction={pauseDiscordAction.bind(null, false)}>Switch the feed back on</Button>
            ) : (
              <Button type="submit" size="sm" variant="ghost" formAction={pauseDiscordAction.bind(null, true)}>Pause the feed</Button>
            )}
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>What is posted</CardTitle>
          <CardDescription>Only what players can see on the Activity page goes to the feed. Players who have not linked their Minecraft account are never named.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveDiscordAction} className="space-y-3">
            {SWITCHES.map((s) => (
              <label key={s.key} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
                <input type="checkbox" name={s.key} defaultChecked={sw[s.key]} className="mt-0.5 h-5 w-5 accent-[var(--primary)]" />
                <span><span className="block font-medium">{s.title}</span><span className="block text-sm text-muted-foreground">{s.example}</span></span>
              </label>
            ))}
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>
      {overview && overview.recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Last messages sent</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {overview.recent.map((r, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                  <span className="w-28 shrink-0 text-muted-foreground">{ukShort(new Date(r.at))}</span>
                  <span className="w-16 shrink-0">{r.channel === "admin" ? "admin" : "feed"}</span>
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
