import Link from "next/link";
import { db } from "@/server/db";
import { DEFAULT_QUESTIONS } from "@/server/vote/tally";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { formatDate } from "@/lib/utils";
import { closeVoteAdminAction, createVoteAction, deleteVoteAction, openVoteAction } from "./actions";

const ERRORS: Record<string, string> = {
  form: "Give the vote a title (2 to 80 characters) and a valid closing date.",
  json: "The questions box isn't valid JSON.",
  "already-open": "Close the open vote before opening another.",
};

export default async function VotesAdminPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const votes = await db.vote.findMany({ orderBy: { opensAt: "desc" }, include: { _count: { select: { ballots: true } } } });
  const tone = { DRAFT: "neutral", OPEN: "good", CLOSED: "warn" } as const;
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Votes</h2>
      {error && <Alert tone="error">{ERRORS[error] ?? "Something went wrong."}</Alert>}
      <Card>
        <CardHeader><CardTitle>New vote</CardTitle><CardDescription>The mod list comes from mods.json; the questions below are the settings questions.</CardDescription></CardHeader>
        <CardContent>
          <form action={createVoteAction} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="title">Title</Label><Input id="title" name="title" defaultValue="Season 1 mods" required minLength={2} maxLength={80} /></div>
              <div><Label htmlFor="closesAt">Closes (optional, closes itself after this)</Label><Input id="closesAt" name="closesAt" type="datetime-local" /></div>
            </div>
            <div>
              <Label htmlFor="questions">Settings questions (JSON)</Label>
              <textarea id="questions" name="questions" rows={10} className="w-full rounded-lg border bg-background p-2 font-mono text-xs" defaultValue={JSON.stringify(DEFAULT_QUESTIONS, null, 2)} />
            </div>
            <Button type="submit">Create draft</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-5">
          {votes.length === 0 ? <p className="text-sm text-muted-foreground">No votes yet.</p> : (
            <ul className="divide-y">
              {votes.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm">
                  <span className="font-medium">{v.title}</span>
                  <Badge tone={tone[v.status]}>{v.status.toLowerCase()}</Badge>
                  <span className="text-muted-foreground">{v._count.ballots} ballot{v._count.ballots === 1 ? "" : "s"}{v.opensAt ? ` · opened ${formatDate(v.opensAt)}` : ""}{v.closesAt ? ` · closes ${formatDate(v.closesAt)}` : ""}</span>
                  <span className="ml-auto flex gap-2">
                    {v.status !== "DRAFT" && <Link href="/pack?tab=results" className="rounded-lg px-3 py-1.5 text-sm hover:bg-muted">Results</Link>}
                    {v.status === "DRAFT" && <form action={openVoteAction}><input type="hidden" name="id" value={v.id} /><Button type="submit" size="sm">Open</Button></form>}
                    {v.status === "OPEN" && <form action={closeVoteAdminAction}><input type="hidden" name="id" value={v.id} /><Button type="submit" size="sm" variant="danger">Close</Button></form>}
                    {v.status !== "OPEN" && <form action={deleteVoteAction}><input type="hidden" name="id" value={v.id} /><Button type="submit" size="sm" variant="ghost">Delete</Button></form>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
