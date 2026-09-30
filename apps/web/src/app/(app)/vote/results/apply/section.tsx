import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth/session";
import { getResultsVote, tallyVote } from "@/server/vote/votes";
import { getManifest, votableMods } from "@/server/modpack/manifest";
import { decide } from "@/server/vote/tally";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonClasses } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { applyResultsAction } from "../actions";

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ threshold?: string }> }) {
  await requireAdmin();
  const vote = await getResultsVote();
  if (!vote || vote.status !== "CLOSED") redirect("/pack?tab=results&applied=not-closed");
  const { threshold: tRaw } = await searchParams;
  const threshold = Math.min(100, Math.max(1, Number(tRaw ?? 50) || 50));
  const manifest = await getManifest();
  const decisions = decide(votableMods(manifest), await tallyVote(vote), threshold);
  const changes = decisions.filter((d) => d.from !== d.to);
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Apply &quot;{vote.title}&quot; to the mod list</h2>
      <Card>
        <CardHeader>
          <CardTitle>What would change in mods.json</CardTitle>
          <CardDescription>Mods at or above the threshold get enabled, the rest disabled; in a &quot;pick one&quot; group only the winner stays. Confirming writes the file and commits it to git.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="get" className="flex items-end gap-2">
            <div className="w-32"><Label htmlFor="threshold">Threshold %</Label><Input id="threshold" name="threshold" type="number" min={1} max={100} defaultValue={threshold} /></div>
            <Button type="submit" variant="secondary">Recalculate</Button>
          </form>
          {changes.length === 0 ? <p className="text-sm text-muted-foreground">No changes: the list already matches.</p> : (
            <ul className="divide-y text-sm">
              {changes.map((d) => (
                <li key={d.slug} className="flex flex-wrap items-center gap-2 py-2">
                  <Badge tone={d.to ? "good" : "bad"}>{d.to ? "enable" : "disable"}</Badge>
                  <span className="font-medium">{d.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{d.slug}</span>
                  <span className="text-muted-foreground">{d.yes} yes · {d.pct}% · {d.reason}</span>
                </li>
              ))}
            </ul>
          )}
          <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Unchanged ({decisions.length - changes.length})</summary>
            <ul className="mt-2 space-y-1">{decisions.filter((d) => d.from === d.to).map((d) => <li key={d.slug}><span className="font-medium">{d.name}</span> stays {d.to ? "in" : "out"} · {d.reason}</li>)}</ul>
          </details>
          <div className="flex gap-2">
            <form action={applyResultsAction}>
              <input type="hidden" name="voteId" value={vote.id} />
              <input type="hidden" name="threshold" value={threshold} />
              <Button type="submit" disabled={changes.length === 0}>Write mods.json and commit</Button>
            </form>
            <Link href="/pack?tab=results" className={buttonClasses("secondary")}>Back</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
