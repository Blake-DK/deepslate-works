"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { DONT_MIND } from "@/shared/polls";
import type { ClientPoll } from "@/server/polls";

type Props = {
  poll: ClientPoll;
  /** Admin → Votes: who voted for what under the results. */
  showVoters?: boolean;
  /** After a vote: refresh the page (the banner goes, the Play button opens). */
  refreshAfter?: boolean;
  className?: string;
};

/**
 * One poll (planner 2026-10-02): the question, its options (with a picture, a link or a mod's card), Vote. After voting
 * the results; "Change my vote" while it is open. The same card on Home, the Play page and Votes.
 */
export function PollCard({ poll: initial, showVoters = false, refreshAfter = false, className }: Props) {
  const router = useRouter();
  const [poll, setPoll] = useState(initial);
  const [picked, setPicked] = useState<string[]>(initial.mine ?? []);
  const [editing, setEditing] = useState(initial.mine === null && initial.open);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setError(null);
    if (!poll.multiple || id === DONT_MIND.id) return setPicked([id]);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.filter((x) => x !== DONT_MIND.id), id]));
  }

  async function vote() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/polls/${encodeURIComponent(poll.id)}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ choices: picked }) });
      const j = (await r.json()) as { poll?: ClientPoll; error?: { message: string } };
      if (!r.ok || !j.poll) throw new Error(j.error?.message ?? "That didn't work. Try again.");
      setPoll(j.poll);
      setEditing(false);
      if (refreshAfter) router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const results = poll.results;
  const choiceText = (ids: string[]) => poll.options.filter((o) => ids.includes(o.id)).map((o) => o.text).join(", ");

  return (
    <div className={cn("space-y-3", className)} data-testid="poll" data-poll={poll.id}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{poll.question}</h3>
        {poll.mustVote && poll.open && <Badge tone="warn">Before you play</Badge>}
        {!poll.open && <Badge>Closed</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">
        {poll.multiple ? "Pick as many as you like." : "Pick one."}
        {poll.open && poll.closes && <> Open until {poll.closes}.</>}
        {!poll.open && poll.closed && <> Closed {poll.closed}.</>}
        {poll.open && poll.mine && <> Your vote: <span className="font-medium text-foreground">{choiceText(poll.mine)}</span>.</>}
      </p>

      {editing ? (
        <fieldset className="space-y-2" disabled={busy}>
          <legend className="sr-only">{poll.question}</legend>
          {poll.options.map((o) => {
            const on = picked.includes(o.id);
            return (
              <label key={o.id} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted", on && "border-primary bg-primary/5", o.id === DONT_MIND.id && "border-dashed")}>
                <input type={poll.multiple && o.id !== DONT_MIND.id ? "checkbox" : "radio"} name={`poll-${poll.id}`} checked={on} onChange={() => toggle(o.id)} className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" />
                {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded picture, served by our own route */}
                {o.imageUrl && <img src={o.imageUrl} alt="" className="h-14 w-20 shrink-0 rounded-md border object-cover" />}
                <span className="min-w-0 flex-1">
                  <span className={cn("block font-medium", o.id === DONT_MIND.id && "text-muted-foreground")}>{o.text || o.mod?.name}</span>
                  {o.mod && <span className="block text-xs text-muted-foreground">{o.mod.name}: {o.mod.description}</span>}
                  {(o.link || o.mod) && (
                    <span className="mt-1 flex flex-wrap gap-3 text-xs">
                      {o.link && <a href={o.link} target="_blank" rel="noreferrer" className="underline" onClick={(e) => e.stopPropagation()}>Find out more</a>}
                      {o.mod && <a href={`https://modrinth.com/mod/${o.mod.slug}`} target="_blank" rel="noreferrer" className="underline" onClick={(e) => e.stopPropagation()}>Mod page</a>}
                      {o.mod && <a href={o.mod.wiki} target="_blank" rel="noreferrer" className="underline" onClick={(e) => e.stopPropagation()}>Wiki</a>}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="button" onClick={vote} disabled={busy || picked.length === 0} data-testid="poll-vote">{busy ? "Saving…" : poll.mine ? "Save my vote" : "Vote"}</Button>
            {poll.mine && <Button type="button" variant="ghost" onClick={() => { setPicked(poll.mine ?? []); setEditing(false); }}>Cancel</Button>}
          </div>
          {error && <Alert tone="error">{error}</Alert>}
        </fieldset>
      ) : results ? (
        <div className="space-y-2" data-testid="poll-results">
          <ul className="space-y-1.5">
            {results.counts.map((c) => (
              <li key={c.id} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className={cn(poll.mine?.includes(c.id) && "font-semibold", c.id === DONT_MIND.id && "text-muted-foreground")}>{c.text}{poll.mine?.includes(c.id) && " ✓"}</span>
                  <span className="tabular-nums text-muted-foreground">{c.votes} · {c.percent}%</span>
                </div>
                <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden><div className={cn("h-full rounded-full", c.id === DONT_MIND.id ? "bg-muted-foreground/40" : "bg-primary")} style={{ width: `${c.percent}%` }} /></div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{results.voters} {results.voters === 1 ? "vote" : "votes"} so far{!poll.open && results.winners.length > 0 ? `. Result: ${results.winners.join(" and ")}` : ""}.</p>
          {poll.open && poll.mine && <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(true)}>Change my vote</Button>}
          {showVoters && poll.voters && poll.voters.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Who voted for what ({poll.voters.length})</summary>
              <ul className="mt-2 space-y-1">{poll.voters.map((v) => <li key={v.name}><span className="font-medium">{v.name}</span>: {choiceText(v.choices)} <span className="text-xs text-muted-foreground">({v.at})</span></li>)}</ul>
            </details>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">The results show once you&apos;ve voted.</p>
      )}
    </div>
  );
}
