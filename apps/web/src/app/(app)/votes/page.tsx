import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboardedUser } from "@/server/auth/session";
import { forClient, listPolls } from "@/server/polls";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PollCard } from "@/components/polls/poll-card";

export const metadata: Metadata = { title: "Votes" };

// Planner 2026-10-02: the quick polls. Open ones first (oldest first, the order the app asks them in), then the
// closed ones with their results, newest first. The season's mod vote has its own page (Mods & vote).
export default async function VotesPage() {
  const user = await requireOnboardedUser();
  const polls = await listPolls({ id: user.id, role: user.role });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Votes</h1>
        <p className="text-muted-foreground">Quick questions for everyone on the server. The results show once you&apos;ve voted; you can change your vote until a poll closes. The season&apos;s mod vote is under <Link href="/pack?tab=vote" className="underline">Mods &amp; vote</Link>.</p>
      </div>
      <Card className={polls.open.length > 0 ? "border-2 border-primary" : undefined}>
        <CardHeader><CardTitle>Open</CardTitle>{polls.open.length === 0 && <CardDescription>Nothing to vote on right now.</CardDescription>}</CardHeader>
        {polls.open.length > 0 && <CardContent className="space-y-6">{polls.open.map((p) => <PollCard key={p.id} poll={forClient(p)} refreshAfter className="border-b pb-6 last:border-b-0 last:pb-0" />)}</CardContent>}
      </Card>
      <Card data-testid="poll-history">
        <CardHeader><CardTitle>Closed</CardTitle>{polls.closed.length === 0 && <CardDescription>No poll has closed yet.</CardDescription>}</CardHeader>
        {polls.closed.length > 0 && <CardContent className="space-y-6">{polls.closed.map((p) => <PollCard key={p.id} poll={forClient(p)} className="border-b pb-6 last:border-b-0 last:pb-0" />)}</CardContent>}
      </Card>
    </div>
  );
}
