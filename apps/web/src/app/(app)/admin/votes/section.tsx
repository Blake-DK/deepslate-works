import Link from "next/link";
import { db } from "@/server/db";
import { requireAdmin } from "@/server/auth/session";
import { DEFAULT_QUESTIONS } from "@/server/vote/tally";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input, Label, fieldClasses } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { formatDate, cn } from "@/lib/utils";
import { ballotMustVoteAction, closePollAction, closeVoteAdminAction, createPollAction, createVoteAction, deletePollAction, deleteVoteAction, editPollAction, openVoteAction, pollMustVoteAction } from "./actions";
import { Select } from "@/components/ui/input";
import { PollCard } from "@/components/polls/poll-card";
import { forClient, listPolls, type PollView } from "@/server/polls";
import { getManifest, votableMods } from "@/server/modpack/manifest";
import { DONT_MIND, MAX_OPTIONS } from "@/shared/polls";
import { dateToUkLocal } from "@/lib/uk-time";
import { Check } from "@/components/ui/check";

const POLL_DONE: Record<string, string> = {
  opened: "Poll opened. It's on the news, and anyone playing got a chat line.",
  closed: "Poll closed. The result is on the news.",
  deleted: "Poll deleted.",
  edited: "Poll saved. Votes already cast stay, and the post in Discord shows the change within a minute.",
  unchanged: "Nothing was changed.",
  "must-vote": "Members now answer this poll before they play. Anyone playing now carries on; it applies from their next join.",
  optional: "This poll is optional now: nobody is held at the door for it.",
};

type Mods = Array<{ slug: string; name: string }>;
type RowValue = { id?: string; text?: string; link?: string | null; modId?: string | null; imageUrl?: string | null };

/** One option's fields: text, a mod's card, a link and a picture. `id` ties an edited row to the option it was. */
function OptionRow({ i, mods, value, testId }: { i: number; mods: Mods; value?: RowValue; testId?: string }) {
  return (
    <div className="grid gap-2 rounded-[4px] border p-2 sm:grid-cols-[1fr_1fr]" data-testid={testId}>
      {value?.id && <input type="hidden" name={`id${i}`} value={value.id} />}
      <Input name={`option${i}`} aria-label={`Option ${i}`} placeholder={value?.id ? "Empty to take it away" : i === 1 ? "Option 1, e.g. The Warden" : i === 2 ? "Option 2, e.g. A Lava Golem" : `Option ${i}`} defaultValue={value?.text ?? ""} maxLength={120} />
      <Select name={`mod${i}`} aria-label={`Option ${i}: a mod's card`} defaultValue={value?.modId ?? ""}>
        <option value="">No mod card</option>
        {mods.map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
        {/* a mod that is no longer up for votes keeps its card unless it is changed here */}
        {value?.modId && !mods.some((m) => m.slug === value.modId) && <option value={value.modId}>{value.modId}</option>}
      </Select>
      <Input name={`link${i}`} aria-label={`Option ${i}: link`} placeholder="Link (optional), https://…" type="url" defaultValue={value?.link ?? ""} maxLength={300} />
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded picture, served by our own route */}
        {value?.imageUrl && <img src={value.imageUrl} alt="" title="Its picture now; pick a file to replace it" className="h-9 w-9 shrink-0 border object-cover" />}
        <Input name={`image${i}`} aria-label={`Option ${i}: picture`} type="file" accept="image/png,image/jpeg,image/webp" className="h-auto py-1.5 text-sm" />
      </div>
    </div>
  );
}

/** Admin → Votes: an open poll's editor (Alex, 2026-10-06), folded under the poll. */
function EditPoll({ poll, mods }: { poll: PollView; mods: Mods }) {
  const current = poll.options.filter((o) => o.id !== DONT_MIND.id);
  const voted = new Map(poll.results?.counts.map((c) => [c.id, c.votes]) ?? []);
  const total = poll.results?.voters ?? 0;
  const dontMind = voted.get(DONT_MIND.id) ?? 0;
  const count = (n: number) => (n === 0 ? "No votes" : `${n} ${n === 1 ? "vote" : "votes"}`);
  const free = MAX_OPTIONS - current.length;
  return (
    <details className="rounded-[4px] border p-3" data-testid="poll-edit">
      <summary className="cursor-pointer text-sm font-medium">Edit this poll</summary>
      <form action={editPollAction.bind(null, poll.id)} className="mt-3 space-y-4">
        <div><Label htmlFor={`q-${poll.id}`}>Question</Label><Input id={`q-${poll.id}`} name="question" defaultValue={poll.question} required minLength={3} maxLength={160} /></div>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Options</legend>
          <p className="text-sm text-muted-foreground" data-testid="poll-edit-votes">{count(total)} so far{total > 0 && <>, {dontMind} of them &ldquo;{DONT_MIND.text}&rdquo; (added to every poll, so it isn&apos;t listed here)</>}.</p>
          {current.map((o, k) => (
            <div key={o.id} className="space-y-1">
              <p className="text-xs text-muted-foreground">{count(voted.get(o.id) ?? 0)}{(voted.get(o.id) ?? 0) > 0 && ": it can be reworded, not taken away"}</p>
              <OptionRow i={k + 1} mods={mods} value={{ id: o.id, text: o.text, link: o.link, modId: o.modId, imageUrl: o.imageUrl }} />
            </div>
          ))}
          {free > 0 && (
            <details className="space-y-2">
              <summary className="cursor-pointer text-sm text-muted-foreground">Add an option ({free} more at most)</summary>
              <div className="mt-2 space-y-2">
                {Array.from({ length: free }, (_, k) => current.length + k + 1).map((i) => <OptionRow key={i} i={i} mods={mods} />)}
              </div>
            </details>
          )}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm"><Check type="checkbox" name="multiple" defaultChecked={poll.multiple} /> Multiple choice</label>
          <label className="flex items-center gap-2 text-sm"><Check type="checkbox" name="mustVote" defaultChecked={poll.mustVote} /> Must vote before playing</label>
          <div><Label htmlFor={`c-${poll.id}`}>Closes (UK time, empty for never)</Label><Input id={`c-${poll.id}`} name="closesAt" type="datetime-local" defaultValue={dateToUkLocal(poll.closesAt)} /></div>
        </div>
        <p className="text-xs text-muted-foreground">Votes already cast stay with their option, here and in Discord. If you reword an option so it means something else, say so in Discord: people who voted for it are not asked again.</p>
        <Button type="submit" size="sm" data-testid="poll-save">Save changes</Button>
      </form>
    </details>
  );
}

const ERRORS: Record<string, string> = {
  form: "Give the vote a title (2 to 80 characters) and a valid closing date.",
  json: "The questions box isn't valid JSON.",
  "already-open": "Close the open vote before opening another.",
};

/** `part` (docs/35): the quick polls are Admin → Votes, the season's mod vote is Modpack → Mod vote. */
export default async function VotesSection({ searchParams, part }: { searchParams: Promise<{ error?: string; poll?: string }>; part: "polls" | "modvote" }) {
  const { error, poll: pollMsg } = await searchParams;
  const admin = await requireAdmin();
  const [votes, polls, mods, members] = await Promise.all([
    db.vote.findMany({ orderBy: { opensAt: "desc" }, include: { _count: { select: { ballots: true } } } }),
    // as this admin, so their own vote (on the site or in Discord) shows as theirs
    listPolls({ id: admin.id, role: "ADMIN" }, 20),
    getManifest().then(votableMods).catch(() => []),
    db.user.count(),
  ]);
  const tone = { DRAFT: "neutral", OPEN: "good", CLOSED: "warn" } as const;
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{part === "polls" ? "Polls" : "Mod vote"}</h2>
      {error && <Alert tone="error">{ERRORS[error] ?? "Something went wrong."}</Alert>}
      {part === "polls" && (<>
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
              {[1, 2, 3, 4].map((i) => <OptionRow key={i} i={i} mods={mods} testId={`poll-option-${i}`} />)}
              <details className="space-y-2">
                <summary className="cursor-pointer text-sm text-muted-foreground">More options (5 to {MAX_OPTIONS})</summary>
                <div className="mt-2 space-y-2">
                  {Array.from({ length: MAX_OPTIONS - 4 }, (_, k) => k + 5).map((i) => <OptionRow key={i} i={i} mods={mods} />)}
                </div>
              </details>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex items-center gap-2 text-sm"><Check type="checkbox" name="multiple" /> Multiple choice</label>
              <label className="flex items-center gap-2 text-sm"><Check type="checkbox" name="mustVote" defaultChecked /> Must vote before playing</label>
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
                <form className="flex flex-wrap gap-2">
                  {p.open && <Button type="submit" size="sm" variant="secondary" formAction={pollMustVoteAction.bind(null, p.id, !p.mustVote)} data-testid="poll-must-vote">{p.mustVote ? "Make optional" : "Must vote before playing"}</Button>}
                  {p.open && <Button type="submit" size="sm" variant="danger" formAction={closePollAction.bind(null, p.id)}>Close now</Button>}
                  {!p.open && <Button type="submit" size="sm" variant="ghost" formAction={deletePollAction.bind(null, p.id)}>Delete</Button>}
                </form>
                {p.open && <EditPoll poll={p} mods={mods} />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      </>)}
      {part === "modvote" && (<>
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
              <textarea id="questions" name="questions" rows={10} className={cn("min-h-11 py-2 font-mono", fieldClasses)} defaultValue={JSON.stringify(DEFAULT_QUESTIONS, null, 2)} />
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
                    {v.status !== "DRAFT" && <Link href="/pack?tab=results" className={buttonClasses("ghost", "sm")}>Results</Link>}
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
      </>)}
    </div>
  );
}
