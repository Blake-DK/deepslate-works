import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboardedUser } from "@/server/auth/session";
import { getHallOfFame, getSeasonPage, lineFor, type LadderEntry, type SeasonPage } from "@/server/season";
import { pickTab, TabbedPage, type PageQuery } from "@/components/tabs";
import { AutoRefresh } from "@/components/auto-refresh";
import { PlayerHead } from "@/components/server/player-head";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ukDayTime } from "@/lib/uk-time";
import { names, type SeasonResult } from "@/shared/season";

export const metadata: Metadata = { title: "Season" };

const TABS = [{ key: "now", label: "This season" }, { key: "hall", label: "Hall of fame" }] as const;
const TIER: Record<number, string> = { 1: "Tier 1", 2: "Tier 2", 3: "Tier 3" };
const pts = (n: number) => `${n} ${n === 1 ? "point" : "points"}`;

// docs/34 §5 (W1.3): the season for players: where it stands, the boss ladder, the trials, the scoreboard, the goal.
// Read-only. A boss or trial that has not opened keeps its name to itself, unless somebody has found it early.
export default async function SeasonPageRoute({ searchParams }: { searchParams: PageQuery }) {
  await requireOnboardedUser("/season");
  const tab = pickTab((await searchParams).tab, TABS);
  return (
    <TabbedPage title="Season" base="/season" tabs={TABS} current={tab}>
      {tab === "hall" ? <Hall /> : <Now />}
    </TabbedPage>
  );
}

async function Now() {
  const page = await getSeasonPage();
  if (!page) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No season yet</CardTitle>
          <CardDescription>When a season is announced, its bosses, trials and scoreboard show up here.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const { file, state, current } = page;
  return (
    <div className="space-y-4">
      <AutoRefresh seconds={30} />
      <Card className="border-2 border-primary" data-testid="season-header">
        <CardHeader>
          <CardTitle>{file.name}</CardTitle>
          <CardDescription>{lineFor(current)}</CardDescription>
        </CardHeader>
        {state === "upcoming" && (
          <CardContent>
            <p className="text-sm text-muted-foreground">It runs until {ukDayTime(new Date(file.endsAt))}. The bosses and the trials are shown when it opens.</p>
          </CardContent>
        )}
        {state === "running" && page.goal && <CardContent><GoalBar goal={page.goal} /></CardContent>}
      </Card>
      {state !== "upcoming" && (
        <>
          <section className="space-y-2">
            <h2 className="text-xl font-semibold">The boss ladder</h2>
            <p className="text-sm text-muted-foreground">A kill counts for everyone who was there. The first on the server get the points twice.</p>
            <ul className="grid gap-3 sm:grid-cols-2" data-testid="season-bosses">{page.bosses.map((b) => <Entry key={b.id} e={b} />)}</ul>
          </section>
          {page.trials.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xl font-semibold">Trials</h2>
              <p className="text-sm text-muted-foreground">One new trial each week. Anyone can do them, at any time once they are open.</p>
              <ul className="grid gap-3 sm:grid-cols-2" data-testid="season-trials">{page.trials.map((t) => <Entry key={t.id} e={t} />)}</ul>
            </section>
          )}
          <Scoreboard page={page} />
        </>
      )}
    </div>
  );
}

function GoalBar({ goal }: { goal: NonNullable<SeasonPage["goal"]> }) {
  return (
    <div data-testid="season-goal">
      <p className="text-sm"><span className="font-medium">Together:</span> {goal.title} · {Math.min(goal.count, goal.target)} of {goal.target}</p>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-[2px] border bg-card-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={goal.percent} aria-label={goal.title}>
        <div className="h-full bg-primary" style={{ width: `${goal.percent}%` }} />
      </div>
    </div>
  );
}

function Entry({ e }: { e: LadderEntry }) {
  const found = e.by.length > 0;
  // not open and not found: the date, and nothing that gives it away
  if (!e.open && !found) {
    return (
      <li className="rounded-[4px] border bg-card p-4">
        <p className="font-medium text-muted-foreground">{e.kind === "boss" ? "A boss" : "A trial"} still to come</p>
        <p className="text-sm text-muted-foreground">Opens {ukDayTime(e.opensAt)} · {pts(e.points)}</p>
      </li>
    );
  }
  const first = e.by.filter((c) => c.first);
  return (
    <li className="space-y-2 rounded-[4px] border bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="font-medium">{e.title}</p>
        {e.tier !== null && <Badge>{TIER[e.tier] ?? `Tier ${e.tier}`}</Badge>}
        <Badge tone="waking">{pts(e.points)}</Badge>
        {!e.open && <Badge tone="info">Found early</Badge>}
      </div>
      {(e.where || e.hint) && <p className="text-sm text-muted-foreground">{[e.where, e.hint].filter(Boolean).join(". ")}</p>}
      {found ? (
        <>
          {first.length > 0 && <p className="text-sm"><span className="text-accent">First on the server:</span> {names(first.map((c) => c.mcName))}, {ukDayTime(first[0]!.at)}</p>}
          <ul className="flex flex-wrap gap-1.5" aria-label={`Who has done ${e.title}`}>
            {e.by.map((c) => (
              <li key={c.mcUuid} title={`${c.mcName}, ${ukDayTime(c.at)}${c.first ? ", first on the server" : ""}`}>
                <Link href={`/players/${c.mcUuid}`}><PlayerHead uuid={c.mcUuid} name={c.mcName} size={24} /></Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Nobody yet.</p>
      )}
    </li>
  );
}

function Scoreboard({ page }: { page: SeasonPage }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold">Scoreboard</h2>
      <Card>
        <CardContent className="p-0">
          {page.board.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No points yet. The first boss or trial puts a name here.</p>
          ) : (
            <ol className="divide-y" data-testid="season-board">
              {page.board.map((r, i) => (
                <li key={r.mcUuid} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-6 text-right text-sm text-muted-foreground">{i + 1}</span>
                  <PlayerHead uuid={r.mcUuid} name={r.mcName} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium"><Link href={`/players/${r.mcUuid}`} className="hover:underline">{r.mcName}</Link></p>
                    <p className="truncate text-sm text-muted-foreground">{r.bosses} {r.bosses === 1 ? "boss" : "bosses"} · {r.trials} {r.trials === 1 ? "trial" : "trials"}{r.firsts > 0 && <> · {r.firsts} first</>}</p>
                  </div>
                  <span className="font-semibold">{pts(r.points)}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function ResultCard({ name, endsAt, result }: { name: string; endsAt: Date; result: SeasonResult }) {
  const top = result.scoreboard.slice(0, 3);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{name}</CardTitle>
        <CardDescription>Ended {ukDayTime(endsAt)}{result.goal && <> · {result.goal.title}: {result.goal.count} of {result.goal.target}</>}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {top.length === 0 ? <p className="text-sm text-muted-foreground">Nobody scored.</p> : (
          <ol className="space-y-1">
            {top.map((r, i) => (
              <li key={r.mcUuid} className="flex items-center gap-2 text-sm">
                <span className="w-5 text-right text-muted-foreground">{i + 1}</span>
                <PlayerHead uuid={r.mcUuid} name={r.mcName} size={24} />
                <span className="font-medium">{r.mcName}</span>
                <span className="text-muted-foreground">{pts(r.points)}</span>
              </li>
            ))}
          </ol>
        )}
        {result.firsts.length > 0 && (
          <ul className="space-y-0.5 text-sm text-muted-foreground">
            {result.firsts.map((f) => <li key={`${f.kind}:${f.itemId}`}><span className="text-foreground">{f.title}</span>: first {f.kind === "boss" ? "felled" : "done"} by {names(f.names)}</li>)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

async function Hall() {
  const hall = await getHallOfFame();
  if (hall.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Nothing here yet</CardTitle>
          <CardDescription>When a season ends, its winners and its firsts are kept here for good.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return <div className="space-y-4">{hall.map((h) => <ResultCard key={h.id} name={h.name} endsAt={h.endsAt} result={h.result} />)}</div>;
}
