import Link from "next/link";
import { db } from "@/server/db";
import { DEFAULT_QUESTIONS } from "@/server/vote/tally";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { formatDate } from "@/lib/utils";
import { ballotMustVoteAction, closePollAction, closeVoteAdminAction, createPollAction, createVoteAction, deletePollAction, deleteVoteAction, openVoteAction } from "./actions";
import { Select } from "@/components/ui/input";
import { PollCard } from "@/components/polls/poll-card";
import { forClient, listPolls } from "@/server/polls";
import { getManifest, votableMods } from "@/server/modpack/manifest";
import { MAX_OPTIONS } from "@/shared/polls";

const POLL_DONE: Record<string, string> = { opened: "Poll opened. It's on the news, and anyone playing got a chat line.", closed: "Poll closed. The result is on the news.", deleted: "Poll deleted." };

const ERRORS: Record<string, string> = {
  form: "Give the vote a title (2 to 80 characters) and a valid closing date.",
  json: "The questions box isn't valid JSON.",
  "already-open": "Close the open vote before opening another.",
};

export default async function VotesAdminPage({ searchParams }: { searchParams: Promise<{ error?: string; poll?: string }> }) {
  const { error, poll: pollMsg } = await searchParams;
  const [votes, polls, mods, members] = await Promise.all([
    db.vote.findMany({ orderBy: { opensAt: "desc" }, include: { _count: { select: { ballots: true } } } }),
    listPolls({ id: "", role: "ADMIN" }, 20),
    getManifest().then(votableMods).catch(() => []),
    db.user.count(),
  ]);
  const tone = { DRAFT: "neutral", OPEN: "good", CLOSED: "warn" } as const;
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Votes</h2>
      {error && <Alert tone="error">{ERRORS[error] ?? "Something went wrong."}</Alert>}
      <Card id="polls" data-testid="poll-editor">
        <CardHeader>
          <CardTitle>New poll</CardTitle>
          <CardDescription>A quick single question, separate from the season&apos;s mod vote. It opens straight away, goes on the news, and anyone playing gets a chat line. &ldquo;I don&apos;t mind&rdquo; is added to every poll by itself.</CardDescription>
        </CardHeader>
        <CardContent>
          {pollMsg && (POLL_DONE[pollMsg] ? <Alert tone="success" className="mb-3">{POLL_DONE[pollMsg]}</Alert> : <Alert tone="error" className="mb-3">{pollMsg}</Alert>)}
          <form action={createPollAction} className="space-y-4">
            <div><Label htmlFor="question">Question</Label><Input id="question" name="question" placeholder="What's the next boss?" required minLength={3} maxLength={160} /></div>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">Options <span className="font-normal text-muted-foreground">(2 to {MAX_OPTIONS}; a picture, a link or a mod from mods.json are optional)</span></legend>
              {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_1fr]" data-testid={`poll-option-${i}`}>
                    <Input name={`option${i}`} aria-label={`Option ${i}`} placeholder={i === 1 ? "Option 1, e.g. The Warden" : i === 2 ? "Option 2, e.g. A Lava Golem" : `Option ${i}`} maxLength={120} />
                    <Select name={`mod${i}`} aria-label={`Option ${i}: a mod's card`} defaultValue="">
                      <option value="">No mod card</option>
                      {mods.map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
                    </Select>
                    <Input name={`link${i}`} aria-label={`Option ${i}: link`} placeholder="Link (optional), https://…" type="url" maxLength={300} />
                    <Input name={`image${i}`} aria-label={`Option ${i}: picture`} type="file" accept="image/png,image/jpeg,image/webp" className="h-auto py-1.5 text-sm" />
                  </div>
              ))}
              <details className="space-y-2">
                <summary className="cursor-pointer text-sm text-muted-foreground">More options (5 to {MAX_OPTIONS})</summary>
                <div className="mt-2 space-y-2">
                  {Array.from({ length: MAX_OPTIONS - 4 }, (_, k) => k + 5).map((i) => (
                    <div key={i} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_1fr]">
                      <Input name={`option${i}`} aria-label={`Option ${i}`} placeholder={`Option ${i}`} maxLength={120} />
                      <Select name={`mod${i}`} aria-label={`Option ${i}: a mod's card`} defaultValue="">
                        <option value="">No mod card</option>
                        {mods.map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
                      </Select>
                      <Input name={`link${i}`} aria-label={`Option ${i}: link`} placeholder="Link (optional), https://…" type="url" maxLength={300} />
                      <Input name={`image${i}`} aria-label={`Option ${i}: picture`} type="file" accept="image/png,image/jpeg,image/webp" className="h-auto py-1.5 text-sm" />
                    </div>
                  ))}
                </div>
              </details>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="multiple" className="h-4 w-4" /> Multiple choice</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="mustVote" defaultChecked className="h-4 w-4" /> Must vote before playing</label>
              <div><Label htmlFor="pollCloses">Closes (UK time, optional)</Label><Input id="pollCloses" name="closesAt" type="datetime-local" /></div>
            </div>
            <p className="text-xs text-muted-foreground">Must vote: members are asked in the app and on the site before Play, and the entrance room holds anyone who joins without voting. Somebody already playing is never kicked or held; it applies from their next join. Admins are asked too but never held.</p>
            <Button type="submit" data-testid="poll-open">Open poll</Button>
          </form>
        </CardContent>
      </Card>
      {polls.open.length + polls.closed.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Polls</CardTitle><CardDescription>{members} {members === 1 ? "member" : "members"}. Results and who voted for what are only shown to admins while a poll is open; members see the results once they have voted.</CardDescription></CardHeader>
          <CardContent className="space-y-6">
            {[...polls.open, ...polls.closed].map((p) => (
              <div key={p.id} className="space-y-2 border-b pb-5 last:border-b-0 last:pb-0">
                <PollCard poll={forClient(p)} showVoters />
                <form className="flex gap-2">
                  {p.open && <Button type="submit" size="sm" variant="danger" formAction={closePollAction.bind(null, p.id)}>Close now</Button>}
                  {!p.open && <Button type="submit" size="sm" variant="ghost" formAction={deletePollAction.bind(null, p.id)}>Delete</Button>}
                </form>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
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
                  {v.mustVote && <Badge tone="warn">must vote</Badge>}
                  <span className="text-muted-foreground">{v._count.ballots} ballot{v._count.ballots === 1 ? "" : "s"}{v.opensAt ? ` · opened ${formatDate(v.opensAt)}` : ""}{v.closesAt ? ` · closes ${formatDate(v.closesAt)}` : ""}</span>
                  <span className="ml-auto flex gap-2">
                    {v.status !== "DRAFT" && <Link href="/pack?tab=results" className="rounded-lg px-3 py-1.5 text-sm hover:bg-muted">Results</Link>}
                    {v.status !== "CLOSED" && <form><Button type="submit" size="sm" variant="secondary" formAction={ballotMustVoteAction.bind(null, v.id, !v.mustVote)}>{v.mustVote ? "Make optional" : "Must vote before playing"}</Button></form>}
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
