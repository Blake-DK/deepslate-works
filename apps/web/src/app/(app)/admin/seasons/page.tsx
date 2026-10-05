import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { apiFetch } from "@/server/api-client";
import { TabbedPage, type PageQuery } from "@/components/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Check } from "@/components/ui/check";
import { Label, fieldClasses } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ukDayTime } from "@/lib/uk-time";
import { seasonOpAction, seasonTickAction } from "./actions";

export const metadata: Metadata = { title: "Seasons" };

type Item = { id: string; title: string };
type View = {
  file: { id: string; name: string; startsAt: string; endsAt: string; bosses: Item[]; trials: Item[] } | null;
  row: { state: "upcoming" | "running" | "ended"; hasResult: boolean; revoked: string[] } | null;
  clears: number;
  ticks?: Array<{ kind: "boss" | "trial"; itemId: string; mcUuid: string; mcName: string; first: boolean }>;
  members: Array<{ mcUuid: string; mcName: string; userId: string }>;
  online: string[];
};

const MSG: Record<string, string> = {
  announce: "Announced. Members now see the Season tab and when it opens.",
  start: "The season has begun. Kills and trials are recorded from now on.",
  end: "The season has ended. Its result is frozen and is in the Hall of fame.",
  reload: "The server is reading its datapacks again.",
  confirm: "Tick the confirmation box first.",
  granted: "Given, on the site and in the game.",
  grantedSite: "Given on the site. They are not on the server, so the game's own tick and the trophy were not given.",
  grantedAlready: "They had that tick already.",
  revoked: "Taken back, on the site and in the game.",
  revokedSite: "Taken back on the site. They are not on the server, so the game's own tick stays until it is taken back there.",
  revokedNone: "They did not have that tick.",
  error: "That didn't work:",
};
const STATE: Record<string, { label: string; tone: "neutral" | "good" | "info" }> = { upcoming: { label: "Announced, not started", tone: "info" }, running: { label: "Running", tone: "good" }, ended: { label: "Ended", tone: "neutral" } };

// docs/34 §6 (W1.4): the season's switches. Which season is current is a commit (modpack/seasons/index.json), and
// so is everything in it; this page announces it, starts it, ends it, and puts a missed tick right.
export default async function SeasonsAdminPage({ searchParams }: { searchParams: PageQuery }) {
  const admin = await requireAdmin();
  const q = await searchParams;
  const msg = typeof q.msg === "string" ? q.msg : undefined;
  const detail = typeof q.detail === "string" ? q.detail : undefined;
  const view = await apiFetch<View>("/seasons", { caller: { id: admin.id, role: "ADMIN" } }).catch(() => null);
  const file = view?.file ?? null;
  const state = view?.row?.state ?? null;
  return (
    <TabbedPage title="Seasons" intro="Announce, start and end the current season, and put a missed boss kill or trial right." base="/admin/seasons" tabs={[]} current="">
      {msg && <Alert tone={msg === "error" || msg === "confirm" ? "error" : "success"}>{MSG[msg] ?? msg} {detail && <span className="font-mono">{detail}</span>}</Alert>}
      {!view && <Alert tone="error">The portal&apos;s backend did not answer. Try again in a moment.</Alert>}
      {view && !file && (
        <Card>
          <CardHeader>
            <CardTitle>No current season</CardTitle>
            <CardDescription>Which season is current is set in the repo: <span className="font-mono">modpack/seasons/index.json</span>, &quot;current&quot;. It names none, or that season&apos;s file does not read.</CardDescription>
          </CardHeader>
        </Card>
      )}
      {view && file && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card data-testid="season-switches">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">{file.name} <Badge tone={state ? STATE[state]!.tone : "neutral"}>{state ? STATE[state]!.label : "Not announced"}</Badge></CardTitle>
              <CardDescription>
                {ukDayTime(new Date(file.startsAt))} to {ukDayTime(new Date(file.endsAt))} · {file.bosses.length} bosses, {file.trials.length} trials · {view.clears} {view.clears === 1 ? "tick" : "ticks"} recorded
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {!state && (
                <form action={seasonOpAction.bind(null, "announce")} className="space-y-2">
                  <p className="text-muted-foreground">Announcing shows the Season tab to members, with the name and the opening time. The bosses and trials stay hidden until it starts.</p>
                  <Button type="submit" size="sm">Announce</Button>
                </form>
              )}
              {(state === null || state === "upcoming") && (
                <form action={seasonOpAction.bind(null, "start")} className="space-y-2">
                  <p className="text-muted-foreground">Starting begins the recording: from then on a boss kill or a finished trial counts. Do it when the season&apos;s datapack is on the server (Modpack → Build, then Sync), not before.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2"><Check type="checkbox" name="sure" /> I&apos;m sure</label>
                    <Button type="submit" size="sm">Start the season</Button>
                  </div>
                </form>
              )}
              {state === "running" && (
                <form action={seasonOpAction.bind(null, "end")} className="space-y-2">
                  <p className="text-muted-foreground">Ending freezes the scoreboard as it stands and puts it in the Hall of fame. It is done once and cannot be undone.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2"><Check type="checkbox" name="sure" /> I&apos;m sure</label>
                    <Button type="submit" size="sm" variant="danger">End the season</Button>
                  </div>
                </form>
              )}
              {state === "ended" && <p className="text-muted-foreground">This season is over and its result is kept. The next one becomes current by a commit to <span className="font-mono">modpack/seasons/index.json</span>.</p>}
              {state && <Link href="/season" className={buttonClasses("secondary", "sm")}>Open the Season page</Link>}
            </CardContent>
          </Card>

          <Card data-testid="season-datapack">
            <CardHeader>
              <CardTitle>The season&apos;s datapack</CardTitle>
              <CardDescription>The bosses&apos; and trials&apos; advancements live in a datapack that Build makes from the season&apos;s file and Sync puts on the server. The server reads it at its next start, or now with a reload.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <form action={seasonOpAction.bind(null, "reload")} className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2"><Check type="checkbox" name="sure" /> I&apos;m sure</label>
                <Button type="submit" size="sm" variant="secondary">Reload datapacks now</Button>
              </form>
              <p className="text-muted-foreground">A reload reads every recipe and tag of every mod again. The game can stand still for some seconds while it does; a restart with nobody on is the gentler way.</p>
            </CardContent>
          </Card>

          {state === "running" && (
            <Card className="lg:col-span-2" data-testid="season-ticks">
              <CardHeader>
                <CardTitle>Give or take back a tick</CardTitle>
                <CardDescription>For a kill the portal missed, or one that should not count. If the member is on the server, the game&apos;s own tick (and the trophy) is given or taken back too; if not, only the site&apos;s.</CardDescription>
              </CardHeader>
              <CardContent>
                <form action={seasonTickAction.bind(null, "")} className="flex flex-wrap items-end gap-3">
                  <div>
                    <Label htmlFor="tick-member">Member</Label>
                    <select id="tick-member" name="userId" required className={cn("mt-1 h-9 text-sm", fieldClasses)}>
                      {view.members.map((m) => <option key={m.userId} value={m.userId}>{m.mcName}{view.online.some((n) => n.toLowerCase() === m.mcName.toLowerCase()) ? " (playing)" : ""}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="tick-item">Boss or trial</Label>
                    <select id="tick-item" name="item" required className={cn("mt-1 h-9 text-sm", fieldClasses)}>
                      <optgroup label="Bosses">{file.bosses.map((b) => <option key={b.id} value={`boss:${b.id}`}>{b.title}</option>)}</optgroup>
                      <optgroup label="Trials">{file.trials.map((t) => <option key={t.id} value={`trial:${t.id}`}>{t.title}</option>)}</optgroup>
                    </select>
                  </div>
                  <Button type="submit" formAction={seasonTickAction.bind(null, "grant")} size="sm">Give</Button>
                  <Button type="submit" formAction={seasonTickAction.bind(null, "revoke")} size="sm" variant="danger">Take back</Button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </TabbedPage>
  );
}
