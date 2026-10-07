"use client";
import { useState, useTransition } from "react";
import type { BlockList } from "modpack/design";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { currentVersion, MAX_ASK, type DesignFile, type DesignSummary } from "@/lib/designer";
import { designAction, designBackAction, designKeepAction, openDesignAction, type DesignResult } from "./design-actions";
import { DesignPicture } from "./design-picture";

// docs/39 Step 2: Admin → Seasons → Builds, "Design a build". Say what it should be; the designer answers with a
// recipe, drawn here; ask for changes in words; keep it when it is right, and it becomes an ordinary upload.

export type DesignCardState = "off" | "notOwner" | "ready";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

export function DesignCard({ state, designs, blocks, initial, left }: { state: DesignCardState; designs: DesignSummary[]; blocks: BlockList; initial: DesignFile | null; left: { hour: number; day: number } | null }) {
  const [design, setDesign] = useState<DesignFile | null>(initial);
  const [error, setError] = useState<{ error: string; text?: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [working, setWorking] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [ask, setAsk] = useState("");
  const [change, setChange] = useState("");

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
  const run = (label: string | null, f: () => Promise<DesignResult>, after?: () => void) =>
    start(async () => {
      setWorking(label);
      try {
        const r = await f();
        take(r);
        if (r.ok) after?.();
      } catch {
        setError({ error: "The page lost the answer (the site restarted, or the connection dropped). If the designer finished, the design is in the list once the page is reloaded." });
      } finally {
        setWorking(null);
      }
    });

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
  const busy = pending && working !== null;
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
              <Button key={d.name} type="button" size="sm" variant={design?.name === d.name ? "primary" : "secondary"} disabled={pending} onClick={() => run(null, () => openDesignAction(d.name))}>
                {d.name} · {d.versions} {d.versions === 1 ? "version" : "versions"}{d.kept ? " · kept" : ""}
              </Button>
            ))}
            {design && <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { setDesign(null); setError(null); setNote(null); }}>New design</Button>}
          </div>
        )}

        {busy && <Alert tone="info">{working} This takes a few minutes. You may leave the page: the design is kept when it is done, and is in the list above when you come back.</Alert>}
        {error && (
          <Alert tone="error">
            <p>{error.error}</p>
            {error.text && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">The designer said: {error.text}</p>}
          </Alert>
        )}
        {note && <Alert tone="success">{note}</Alert>}

        {!design && (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run("Designing…", () => designAction({ name, ask, fresh: true }), () => setAsk("")); }}>
            <div>
              <Label htmlFor="d-name">Name</Label>
              <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} required pattern="[a-z0-9_]{2,24}" placeholder="temple" className="mt-1 h-9 w-48 text-sm" />
            </div>
            <div>
              <Label htmlFor="d-ask">What should it be?</Label>
              <Textarea id="d-ask" value={ask} onChange={(e) => setAsk(e.target.value)} required maxLength={MAX_ASK} rows={4} className="mt-1" placeholder="A temple for the boss portal at spawn, about 40 by 40, deepslate and copper." />
            </div>
            <Button type="submit" size="sm" disabled={pending}>Design</Button>
          </form>
        )}

        {design && v && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="font-mono text-base font-semibold">{design.name}</h3>
              <span className="text-muted-foreground">version {v.n} of {design.versions.length} · {v.recipe.size.x} by {v.recipe.size.y} by {v.recipe.size.z}, the floor at layer {v.recipe.ground}</span>
              {design.kept && <Badge tone={design.kept.version === v.n ? "good" : "neutral"}>kept: version {design.kept.version}</Badge>}
            </div>
            {v.say && <blockquote className="border-l-2 border-edge pl-3 whitespace-pre-wrap">{v.say}</blockquote>}
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

            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run("Changing it…", () => designAction({ name: design.name, ask: change, fresh: false }), () => setChange("")); }}>
              <Label htmlFor="d-change">What should change?</Label>
              <Textarea id="d-change" value={change} onChange={(e) => setChange(e.target.value)} required maxLength={MAX_ASK} rows={3} placeholder="Make the roof steeper and the door 5 wide." />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={pending}>Change it</Button>
                <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => run(null, () => designKeepAction(design.name))}>
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
                    {x.n !== v.n && <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => run(null, () => designBackAction(design.name, x.n))}>Back to version {x.n}</Button>}
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
