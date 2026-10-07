"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BlockList } from "modpack/design";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { currentVersion, designName, MAX_ASK, MAX_TITLE, type DesignFile, type DesignSummary } from "@/lib/designer";
import type { DesignJob } from "@/server/design-jobs";
import { clearJobAction, designAction, designBackAction, designKeepAction, openDesignAction, type DesignResult, type StartResult } from "./design-actions";
import { DesignPicture } from "./design-picture";

// docs/39 Step 2, docs/40: Admin → Seasons → Builds, "Design a build". Say what it should be, under any name; the
// designer answers with a recipe, drawn here; ask for changes in words; keep it when it is right, and it becomes an
// ordinary upload. A design carries on when the page is left: the card shows the job with the page and, while it
// runs, asks how far it has got every 5 seconds while the tab is seen.

export type DesignCardState = "off" | "notOwner" | "ready";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const since = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};
const STAGE: Record<DesignJob["stage"], string> = {
  designing: "The designer is working on it.",
  fixing: "Its first recipe did not pass our checks; it has been sent back once to be fixed.",
  checking: "The answer is in and being checked.",
};

export function DesignCard({ state, designs, blocks, initial, left, job: firstJob, taken }: {
  state: DesignCardState;
  designs: DesignSummary[];
  blocks: BlockList;
  initial: DesignFile | null;
  left: { hour: number; day: number } | null;
  /** docs/40 Part 2: the job running or failed when the page was made */
  job: DesignJob | null;
  /** names of designs and uploads: a new design under one of them gets _2, _3 … */
  taken: string[];
}) {
  const router = useRouter();
  const [design, setDesign] = useState<DesignFile | null>(initial);
  const [job, setJob] = useState<DesignJob | null>(firstJob);
  const [error, setError] = useState<{ error: string; text?: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [ask, setAsk] = useState("");
  const [change, setChange] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const pageTitle = useRef<string | null>(null);

  const take = (r: DesignResult) => {
    if (r.ok) {
      setDesign(r.design);
      setError(null);
      setNote(r.note ?? null);
    } else {
      if (r.design !== undefined) setDesign(r.design);
      setError({ error: r.error, text: r.text });
      setNote(null);
    }
  };
  const run = (f: () => Promise<DesignResult>) =>
    start(async () => {
      try {
        take(await f());
      } catch {
        setError({ error: "The page lost the answer (the site restarted, or the connection dropped). Reload the page." });
      }
    });
  const begin = (f: () => Promise<StartResult>, after: () => void) =>
    start(async () => {
      try {
        const r = await f();
        if (r.ok) {
          setJob(r.job);
          setError(null);
          setNote(null);
          after();
        } else {
          if (r.design !== undefined) setDesign(r.design);
          setError({ error: r.error });
        }
      } catch {
        setError({ error: "The page lost the answer (the site restarted, or the connection dropped). Reload the page: if the design started, it shows there." });
      }
    });

  /** The job has ended: show the design it made, or why it failed; mark the tab when nobody is looking. */
  const ended = useCallback(async (was: DesignJob, next: DesignJob | null) => {
    setJob(next);
    if (next?.failed) {
      setError({ error: next.failed, text: next.text });
      return;
    }
    const r = await openDesignAction(was.name);
    take(r);
    if (r.ok) setNote(`${was.title ?? was.name} is ready: version ${r.design.current}.`);
    router.refresh(); // the list of designs and the calls left
    if (document.hidden && pageTitle.current === null) {
      pageTitle.current = document.title;
      document.title = `✓ ${was.name} is ready · ${document.title}`;
    }
  }, [router]);

  // while a job runs: ask every 5 seconds when the tab is seen, and once when it is seen again
  useEffect(() => {
    if (!job || job.failed) return;
    let stop = false;
    const ask = async () => {
      if (stop || document.hidden) return;
      try {
        const res = await fetch("/api/admin/designer/job", { cache: "no-store" });
        if (!res.ok || stop) return;
        const { job: next } = (await res.json()) as { job: DesignJob | null };
        if (stop) return;
        if (!next || next.name !== job.name || next.startedAt !== job.startedAt || next.failed) await ended(job, next && next.startedAt === job.startedAt ? next : null);
        else if (next.stage !== job.stage) setJob(next);
      } catch {
        // the next round tries again
      }
    };
    const timer = setInterval(ask, 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    document.addEventListener("visibilitychange", ask);
    return () => {
      stop = true;
      clearInterval(timer);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", ask);
    };
  }, [job, ended]);

  // the tab's "✓ … is ready" goes when the tab is looked at
  useEffect(() => {
    const seen = () => {
      if (!document.hidden && pageTitle.current !== null) {
        document.title = pageTitle.current;
        pageTitle.current = null;
      }
    };
    document.addEventListener("visibilitychange", seen);
    return () => document.removeEventListener("visibilitychange", seen);
  }, []);

  if (state !== "ready") {
    return (
      <Card className={cn(state === "notOwner" && "opacity-60")} data-testid="design-card">
        <CardHeader>
          <CardTitle>Design a build</CardTitle>
          <CardDescription>{state === "off" ? "Not set up. The designer runs in a container of its own on the VPS (docs/39)." : "Only the owner can use the designer: it runs on the owner's own plan."}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const v = design ? currentVersion(design) : null;
  const running = Boolean(job && !job.failed);
  const off = pending || running;
  const savedAs = designName(name, ask, new Set(taken));
  return (
    <Card id="design" data-testid="design-card">
      <CardHeader>
        <CardTitle>Design a build</CardTitle>
        <CardDescription>
          Say what you want built. The designer answers with a plan of shapes, which the site turns into a build and draws here. Ask for changes in words until it is right, then keep it: it becomes an upload like any other, for Build, Sync and Place.
          {left && <> {left.day} {left.day === 1 ? "call" : "calls"} left today, {left.hour} this hour.</>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {designs.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Your designs:</span>
            {designs.map((d) => (
              <Button key={d.name} type="button" size="sm" variant={design?.name === d.name ? "primary" : "secondary"} disabled={pending} onClick={() => run(() => openDesignAction(d.name))}>
                {d.title ?? d.name} · {d.versions} {d.versions === 1 ? "version" : "versions"}{d.kept ? " · kept" : ""}
              </Button>
            ))}
            {design && <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { setDesign(null); setError(null); setNote(null); }}>New design</Button>}
          </div>
        )}

        {job && !job.failed && (
          <Alert tone="info" data-testid="design-job">
            <p><strong>Designing {job.title ?? job.name}…</strong> started {clock(job.startedAt)}, {since(job.startedAt, now)}. {STAGE[job.stage]}</p>
            <p className="mt-1 text-muted-foreground">A design takes about 10 minutes, up to 15. You may leave the page or close it: the design carries on, and is in the list above when it is done.</p>
          </Alert>
        )}
        {job?.failed && (
          <Alert tone="error">
            <p><strong>{job.title ?? job.name}</strong>, started {clock(job.startedAt)}: {job.failed}</p>
            {job.text && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">The designer said: {job.text}</p>}
            <Button type="button" size="sm" variant="secondary" className="mt-2" disabled={pending} onClick={() => start(async () => { await clearJobAction(); setJob(null); setError(null); })}>Clear</Button>
          </Alert>
        )}
        {error && !job?.failed && (
          <Alert tone="error">
            <p>{error.error}</p>
            {error.text && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">The designer said: {error.text}</p>}
          </Alert>
        )}
        {note && <Alert tone="success">{note}</Alert>}

        {!design && (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); begin(() => designAction({ name, ask, fresh: true }), () => { setAsk(""); setName(""); }); }}>
            <div>
              <Label htmlFor="d-name">Name</Label>
              <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_TITLE} placeholder="Boss temple" className="mt-1 h-9 w-64 text-sm" />
              <p className="mt-1 text-xs text-muted-foreground">Saved as <span className="font-mono text-foreground">{savedAs}</span>{name.trim() ? "" : " (from what you ask for; type a name to choose one)"}</p>
            </div>
            <div>
              <Label htmlFor="d-ask">What should it be?</Label>
              <Textarea id="d-ask" value={ask} onChange={(e) => setAsk(e.target.value)} required maxLength={MAX_ASK} rows={4} className="mt-1" placeholder="A temple for the boss portal at spawn, about 40 by 40, deepslate and copper." />
            </div>
            <Button type="submit" size="sm" disabled={off}>Design</Button>
          </form>
        )}

        {design && v && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-base font-semibold">{design.title ?? design.name}</h3>
              {design.title && <span className="font-mono text-muted-foreground">{design.name}</span>}
              <span className="text-muted-foreground">version {v.n} of {design.versions.length} · {v.recipe.size.x} by {v.recipe.size.y} by {v.recipe.size.z}, the floor at layer {v.recipe.ground}</span>
              {design.kept && <Badge tone={design.kept.version === v.n ? "good" : "neutral"}>kept: version {design.kept.version}</Badge>}
            </div>
            {v.say && <blockquote className="border-l-2 border-edge pl-3 whitespace-pre-wrap">{v.say}</blockquote>}
            {v.plan && v.plan.length > 0 && (
              <div>
                <p className="font-medium">The parts</p>
                <ul className="list-disc pl-5 text-muted-foreground">{v.plan.map((p, i) => <li key={i}>{p}</li>)}</ul>
              </div>
            )}
            <DesignPicture recipe={v.recipe} blocks={blocks} />
            {v.recipe.materials && Object.keys(v.recipe.materials).length > 0 && (
              <div>
                <p className="font-medium">Materials</p>
                <ul className="text-muted-foreground">
                  {Object.entries(v.recipe.materials).map(([k, m]) => (
                    <li key={k}><span className="text-foreground">{k}</span>: {typeof m === "string" ? m : m.map(([b, w]) => `${b} ×${w}`).join(", ")}</li>
                  ))}
                </ul>
              </div>
            )}
            {(v.recipe.markers ?? []).length > 0 && (
              <div>
                <p className="font-medium">Markers (from the lowest north-west corner: east, up, south)</p>
                <ul className="text-muted-foreground">
                  {(v.recipe.markers ?? []).map((m) => <li key={`${m.name}-${m.at.join(",")}`}><span className="text-foreground">{m.name}</span> at {m.at.join(", ")}{m.note ? `: ${m.note}` : ""}</li>)}
                </ul>
              </div>
            )}

            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); begin(() => designAction({ name: design.name, ask: change, fresh: false }), () => setChange("")); }}>
              <Label htmlFor="d-change">What should change?</Label>
              <Textarea id="d-change" value={change} onChange={(e) => setChange(e.target.value)} required maxLength={MAX_ASK} rows={3} placeholder="Make the roof steeper and the door 5 wide." />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={off}>Change it</Button>
                <Button type="button" size="sm" variant="secondary" disabled={off} onClick={() => run(() => designKeepAction(design.name))}>
                  {design.kept ? `Keep version ${v.n} instead` : "Keep this build"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Keeping it makes the upload {design.name}.nbt (an upload of that name is replaced). Then Build and Sync on the Modpack page, and Place below or WorldEdit.</p>
            </form>

            <div>
              <p className="font-medium">Versions</p>
              <ol className="divide-y">
                {[...design.versions].reverse().map((x) => (
                  <li key={x.n} className="flex flex-wrap items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className={cn(x.n === v.n && "font-semibold")}>Version {x.n}</span>{" "}
                      <span className="text-muted-foreground">· {when(x.at)} · {Math.round(x.ms / 1000)} s, {x.tokens.output.toLocaleString("en-GB")} tokens{x.fixed ? " · sent back once" : ""} · “{x.ask.length > 120 ? `${x.ask.slice(0, 120)}…` : x.ask}”</span>
                    </span>
                    {x.n !== v.n && <Button type="button" size="sm" variant="secondary" disabled={off} onClick={() => run(() => designBackAction(design.name, x.n))}>Back to version {x.n}</Button>}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
