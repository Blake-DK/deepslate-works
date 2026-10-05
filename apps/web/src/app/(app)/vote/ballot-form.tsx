"use client";
import { useMemo, useState, useTransition } from "react";
import type { Load, Mod } from "modpack";
import { estimateLoad } from "modpack/load";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PickBox } from "@/components/ui/pick-box";
import { LoadChip } from "@/components/mods/load-chip";
import { ModLinks } from "@/components/mods/mod-card";
import { cn } from "@/lib/utils";
import { saveBallot, type SaveResult } from "./actions";
import type { Question } from "@/server/vote/tally";

type Props = {
  voteId: string;
  sections: Array<{ id: string; title: string; blurb: string; mods: Mod[] }>;
  questions: Question[];
  initial: { modIds: string[]; answers: Record<string, string>; savedAt: string | null } | null;
  tier: "LOW" | "MID" | "HIGH" | null;
  /** When the vote closes, already written out in UK time on the server: the browser's clock and zone play no part. */
  closes: string | null;
};

const TONE: Record<Load, "good" | "warn" | "bad"> = { L: "good", M: "warn", H: "bad" };

export function BallotForm({ voteId, sections, questions, initial, tier, closes: closesText }: Props) {
  const all = useMemo(() => sections.flatMap((s) => s.mods), [sections]);
  const bySlug = useMemo(() => new Map(all.map((m) => [m.slug, m])), [all]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial?.modIds ?? all.filter((m) => m.recommended && !m.exclusiveGroup).map((m) => m.slug)));
  const [answers, setAnswers] = useState<Record<string, string>>(initial?.answers ?? {});
  const [result, setResult] = useState<SaveResult | null>(initial?.savedAt ? { ok: true, savedAt: initial.savedAt } : null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();

  const est = estimateLoad([...picked].map((s) => bySlug.get(s)!).filter(Boolean));
  const heavyWarning = est.band === "H" && tier === "LOW";

  function toggle(mod: Mod) {
    setDirty(true);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(mod.slug)) next.delete(mod.slug);
      else {
        if (mod.exclusiveGroup) for (const m of all) if (m.exclusiveGroup === mod.exclusiveGroup) next.delete(m.slug);
        next.add(mod.slug);
      }
      return next;
    });
  }

  function submit() {
    start(async () => {
      const r = await saveBallot({ voteId, modIds: [...picked], answers });
      setResult(r);
      if (r.ok) setDirty(false);
    });
  }

  return (
    <div className="space-y-8 pb-28">
      {sections.map((s) => (
        <section key={s.id} className="space-y-3">
          <div>
            <h2 className="text-xl font-semibold">{s.title}</h2>
            {s.blurb && <p className="text-sm text-muted-foreground">{s.blurb}</p>}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {s.mods.map((mod) => {
              const on = picked.has(mod.slug);
              return (
                <label key={mod.slug} className={cn("flex cursor-pointer gap-3 rounded-[4px] border bg-card p-4", on && "border-2 border-primary p-[15px]")}>
                  <PickBox on={on} type={mod.exclusiveGroup ? "radio" : "checkbox"} name={mod.exclusiveGroup ?? mod.slug} onChange={() => toggle(mod)} onClick={mod.exclusiveGroup && on ? () => toggle(mod) : undefined} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{mod.name}</span>
                      <LoadChip load={mod.load} />
                      {mod.recommended && <Badge tone="warn">Suggested</Badge>}
                      {mod.exclusiveGroup && <Badge>pick one</Badge>}
                    </span>
                    <span className="mt-1 block text-sm">{mod.description}</span>
                    {mod.note && <span className="mt-1 block text-xs text-muted-foreground">{mod.note}</span>}
                    <span className="mt-2 block" onClick={(e) => e.preventDefault()}><ModLinks mod={mod} compact /></span>
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      ))}

      {questions.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-xl font-semibold">Server settings</h2>
            <p className="text-sm text-muted-foreground">Quick questions so the world is set up once, properly.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {questions.map((q) => (
              <fieldset key={q.id} className="rounded-[4px] border bg-card p-4">
                <legend className="px-1 font-semibold">{q.text}</legend>
                <div className="mt-2 space-y-1.5">
                  {q.options.map((o) => (
                    <label key={o} className="flex cursor-pointer items-center gap-2 text-sm">
                      <PickBox on={answers[q.id] === o} type="radio" name={`q-${q.id}`} onChange={() => { setDirty(true); setAnswers((a) => ({ ...a, [q.id]: o })); }} />
                      {o}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t bg-panel">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
          <span><strong>{picked.size}</strong> picked</span>
          <span className="flex items-center gap-1">Load: <Badge tone={TONE[est.band]}>{est.label}</Badge></span>
          {heavyWarning && <span className="text-danger">That&apos;s a heavy set for your PC. Consider dropping a Heavy mod.</span>}
          <span className="ml-auto flex items-center gap-3">
            {result && !result.ok && <span className="text-danger">{result.error}</span>}
            {result?.ok && !dirty && <span className="text-accent">Saved{closesText ? ` · closes ${closesText}` : ""}</span>}
            {dirty && <span className="text-muted-foreground">Unsaved changes</span>}
            <Button onClick={submit} disabled={pending} size="md" variant="copper">{pending ? "Saving…" : result?.ok ? "Save changes" : "Submit my vote"}</Button>
          </span>
        </div>
      </div>
    </div>
  );
}
