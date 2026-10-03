import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import { PollCard } from "./poll-card";
import { forClient, type pendingFor } from "@/server/polls";

/**
 * Planner 2026-10-02: the must-vote polls a member has not answered, as a banner on Home and on the Play page, oldest
 * first. Voting refreshes the page: the banner goes and Play opens. A must-vote mod ballot is a link to it.
 */
export function VoteBanner({ pending }: { pending: Awaited<ReturnType<typeof pendingFor>> }) {
  if (pending.list.length === 0) return null;
  const many = pending.list.length > 1;
  return (
    <Card id="vote" className="scroll-mt-20 border-2 border-primary" data-testid="vote-banner">
      <CardHeader>
        <CardTitle>{many ? `${pending.list.length} new votes` : "There's a new vote"}</CardTitle>
        <CardDescription>Answer before you play: it takes ten seconds. {many ? "One after another, oldest first." : ""} You can change your vote until it closes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {pending.list.map((item) => {
          if (item.kind === "ballot") {
            return (
              <div key={item.id} className="space-y-2">
                <p className="font-semibold">{item.title}</p>
                <p className="text-sm text-muted-foreground">The season&apos;s mod vote: tick the mods you want. It takes two minutes on a phone.</p>
                <Link href="/pack?tab=vote" className={buttonClasses("copper", "sm")}>Vote on the mods</Link>
              </div>
            );
          }
          const p = pending.polls.find((x) => x.id === item.id);
          return p ? <PollCard key={p.id} poll={forClient(p)} refreshAfter /> : null;
        })}
      </CardContent>
    </Card>
  );
}
