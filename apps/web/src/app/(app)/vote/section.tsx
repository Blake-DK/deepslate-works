import Link from "next/link";
import { requireOnboardedUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { getManifest, sections } from "@/server/modpack/manifest";
import { getOpenVote } from "@/server/vote/votes";
import { parseQuestions } from "@/server/vote/tally";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import { LoadChip } from "@/components/mods/load-chip";
import { BallotForm } from "./ballot-form";
import { ukDayTime } from "@/lib/uk-time";

export default async function VotePage() {
  const user = await requireOnboardedUser();
  const vote = await getOpenVote();
  if (!vote) {
    const last = await db.vote.findFirst({ where: { status: "CLOSED" }, orderBy: { closesAt: "desc" } });
    return (
      <Card>
        <CardHeader>
          <CardTitle>No vote open right now</CardTitle>
          <CardDescription>{last ? "The last vote has closed." : "Alex will open the season vote soon. Until then, have a look at the mod list."}</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          {last && <Link href="/pack?tab=results" className={buttonClasses("primary", "sm")}>See the results</Link>}
          <Link href="/pack" className={buttonClasses("secondary", "sm")}>Mod list</Link>
        </CardContent>
      </Card>
    );
  }
  const manifest = await getManifest();
  const ballot = await db.ballot.findUnique({ where: { voteId_userId: { voteId: vote.id, userId: user.id } } });
  const votable = sections(manifest, { votableOnly: true }).map((s) => ({ id: s.category.id, title: s.category.title, blurb: s.category.blurb, mods: s.mods }));
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{vote.title}</h2>
        <p className="mt-1 max-w-2xl text-muted-foreground">Tick what you want. Suggested mods are pre-ticked. You can change your vote until it closes.</p>
        <div className="mt-3 rounded-[4px] border bg-card p-4 text-sm">
          <p className="font-medium">Rule of thumb</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Pick one gun mod, not both. They do the same job and double the load.</li>
            <li>Create plus one electric tech mod is plenty for a first season. More can be added later.</li>
            <li>Anything marked <LoadChip load="H" /> needs a majority of the &quot;yes&quot; votes from people on weaker PCs, otherwise it stays out.</li>
          </ul>
          <p className="mt-2 text-muted-foreground">Everyone gets the <Link href="/pack#base" className="underline">base pack</Link> whatever happens. {user.role === "ADMIN" && <Link href="/pack?tab=results" className="underline">Live results</Link>}</p>
        </div>
      </div>
      <BallotForm
        voteId={vote.id}
        sections={votable}
        questions={parseQuestions(vote.questions)}
        initial={ballot ? { modIds: ballot.modIds, answers: (ballot.answers ?? {}) as Record<string, string>, savedAt: ballot.submittedAt.toISOString() } : null}
        tier={user.pcTier}
        closes={vote.closesAt ? ukDayTime(vote.closesAt) : null}
      />
    </div>
  );
}
