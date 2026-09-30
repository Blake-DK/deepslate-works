import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOnboardedUser } from "@/server/auth/session";
import { getResultsVote, tallyVote } from "@/server/vote/votes";
import { getManifest, votableMods } from "@/server/modpack/manifest";
import { TIER_KEYS, type Tally } from "@/server/vote/tally";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { LoadChip } from "@/components/mods/load-chip";
import { formatDate } from "@/lib/utils";
import { closeVoteAction } from "./actions";

const APPLIED: Record<string, { tone: "success" | "error" | "info"; text: string }> = {
  ok: { tone: "success", text: "Results applied and committed. The mod list now reflects the vote." },
  nocommit: { tone: "error", text: "mods.json was updated but the git commit failed. See the audit log on the admin page." },
  nothing: { tone: "info", text: "Nothing to change: the mod list already matches the results." },
  "not-closed": { tone: "error", text: "Close the vote before applying results." },
};

const TIER_LABEL = { LOW: "weak PC", MID: "mid PC", HIGH: "strong PC", UNKNOWN: "unknown" } as const;

export default async function ResultsPage({ searchParams }: { searchParams: Promise<{ applied?: string }> }) {
  const user = await requireOnboardedUser();
  const { applied } = await searchParams;
  const vote = await getResultsVote();
  if (!vote) notFound();
  const isAdmin = user.role === "ADMIN";
  if (vote.status === "OPEN" && !isAdmin) {
    return (
      <Card><CardHeader><CardTitle>Results come when the vote closes</CardTitle><CardDescription>Until then, <Link href="/pack?tab=vote" className="underline">cast or change your vote</Link>.</CardDescription></CardHeader></Card>
    );
  }
  const manifest = await getManifest();
  const mods = votableMods(manifest);
  const t: Tally = vote.status === "CLOSED" && vote.resultJson ? (vote.resultJson as unknown as Tally) : await tallyVote(vote);
  const byslug = new Map(t.mods.map((m) => [m.slug, m]));
  const groups = manifest.categories.filter((c) => c.votable).map((c) => ({ c, mods: mods.filter((m) => m.category === c.id) }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-xl font-semibold">{vote.title} · results</h2>
          <p className="text-sm text-muted-foreground">
            {vote.status === "OPEN" ? "Live, only admins can see this while the vote is open." : `Closed ${formatDate(vote.closesAt)}.`} {t.ballots} ballot{t.ballots === 1 ? "" : "s"}:{" "}
            {TIER_KEYS.filter((k) => t.byTier[k]).map((k) => `${t.byTier[k]} ${TIER_LABEL[k]}`).join(", ") || "none yet"}.
          </p>
        </div>
        {isAdmin && (
          <div className="ml-auto flex gap-2">
            {vote.status === "OPEN" ? (
              <form action={closeVoteAction}><input type="hidden" name="voteId" value={vote.id} /><Button type="submit" variant="danger" size="sm">Close vote</Button></form>
            ) : (
              <Link href="/admin/pack?tab=apply" className={buttonClasses("primary", "sm")}>Apply results</Link>
            )}
          </div>
        )}
      </div>
      {applied && APPLIED[applied] && <Alert tone={APPLIED[applied].tone}>{APPLIED[applied].text}</Alert>}

      {groups.map(({ c, mods }) => (
        <Card key={c.id}>
          <CardHeader><CardTitle>{c.title}</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y">
              {mods.map((m) => {
                const r = byslug.get(m.slug);
                const pct = r?.pct ?? 0;
                return (
                  <li key={m.slug} className="grid gap-x-3 gap-y-1 py-2 text-sm sm:grid-cols-[1fr_auto]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{m.name}</span>
                      <LoadChip load={m.load} />
                      {m.enabled && <Badge tone="good">in the pack</Badge>}
                      {r?.lowTierMajority === false && <Badge tone="bad">no weak-PC majority</Badge>}
                    </div>
                    <div className="text-right tabular-nums"><strong>{r?.yes ?? 0}</strong> yes · {pct}%</div>
                    <div className="sm:col-span-2">
                      <div className="h-2 w-full overflow-hidden rounded bg-muted"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {TIER_KEYS.filter((k) => (r?.byTier[k].total ?? 0) > 0).map((k) => <span key={k}>{TIER_LABEL[k]}: {r!.byTier[k].yes}/{r!.byTier[k].total}</span>)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ))}

      {t.questions.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Server settings</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {t.questions.map((q) => (
              <div key={q.id}>
                <p className="font-medium">{q.text}</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {q.options.map((o) => (
                    <li key={o.option} className="flex items-center gap-2">
                      <span className="w-8 text-right tabular-nums">{o.count}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded bg-muted"><div className="h-full bg-accent" style={{ width: `${q.answered ? (o.count / q.answered) * 100 : 0}%` }} /></div>
                      <span className="w-2/5 truncate">{o.option}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
