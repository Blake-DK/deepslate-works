"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PickBox } from "@/components/ui/pick-box";
import { shortLabel } from "@/lib/blocks";
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
  const voteLabel = busy ? "Saving…" : poll.mine ? "Save my vote" : "Vote";
  const choiceText = (ids: string[]) => poll.options.filter((o) => ids.includes(o.id)).map((o) => o.text).join(", ");

  return (
    <div className={cn("space-y-3", className)} data-testid="poll" data-poll={poll.id}>
      {/* docs/23 §5: the step line, as the app's Vote tab has it */}
      {poll.open && !poll.mine && <p className="text-xs font-semibold tracking-wide text-info uppercase" data-testid="poll-step">There&apos;s a new vote{poll.closes && <> · closes {poll.closes}</>}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-2xl font-semibold">{poll.question}</h3>
        {poll.mustVote && poll.open && <Badge tone="warn">Before you play</Badge>}
        {!poll.open && <Badge>Closed</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">
        {poll.multiple ? "Pick as many as you like." : "Pick one."}
        {poll.open && poll.closes && <> Open until {poll.closes}.</>}
        {!poll.open && poll.closed && <> Closed {poll.closed}.</>}
        {poll.open && poll.mine && <> Your vote: <span className="font-medium text-foreground">{choiceText(poll.mine)}</span>.</>}
      </p>

      {editing ? (
        <fieldset className="space-y-3" disabled={busy}>
          <legend className="sr-only">{poll.question}</legend>
          <div className="grid gap-3 min-[760px]:grid-cols-2">
          {poll.options.map((o) => {
            const on = picked.includes(o.id);
            return (
              <label key={o.id} className={cn("flex cursor-pointer gap-3 rounded-[4px] border bg-card p-3 text-sm hover:bg-card-2", on && "border-2 border-primary p-[11px]", o.id === DONT_MIND.id && !on && "border-dashed")}>
                <PickBox on={on} type={poll.multiple && o.id !== DONT_MIND.id ? "checkbox" : "radio"} name={`poll-${poll.id}`} onChange={() => toggle(o.id)} />
                {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded picture, served by our own route */}
                {o.imageUrl && <img src={o.imageUrl} alt="" className="h-9 w-9 shrink-0 border object-cover" />}
                <span className="min-w-0 flex-1">
                  <span className={cn("block font-semibold", o.id === DONT_MIND.id && "text-muted-foreground")}>{o.text || o.mod?.name}</span>
                  {o.mod && <span className="block text-[13.5px] text-muted-foreground">{o.mod.name}: {o.mod.description}</span>}
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
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
            {poll.mustVote && !poll.mine && <span className="text-sm text-muted-foreground">Play opens as soon as you&apos;ve voted.</span>}
            {poll.mine && <Button type="button" variant="ghost" onClick={() => { setPicked(poll.mine ?? []); setEditing(false); }}>Cancel</Button>}
            {/* the Vote block (docs/23 §5): the pixel face at 24 on Copper, text in --primary-foreground */}
            <Button type="button" variant="copper" size="lg" onClick={vote} disabled={busy || picked.length === 0} data-testid="poll-vote" className={cn("min-w-[150px]", shortLabel(voteLabel) ? "font-display text-[24px] font-bold" : "text-[15px]")}>{voteLabel}</Button>
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
                <div className="mt-0.5 h-2 overflow-hidden bg-panel" aria-hidden><div className={cn("h-full", c.id === DONT_MIND.id ? "bg-dim" : "bg-primary")} style={{ width: `${c.percent}%` }} /></div>
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
