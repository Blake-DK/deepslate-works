import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check } from "@/components/ui/check";
import { Input, Label, fieldClasses } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ukShort } from "@/lib/uk-time";
import { buildCaptureAction, buildPlaceAction } from "./actions";

export type BuildsView = {
  builds: Array<{ name: string; size: { x: number; y: number; z: number }; from: { dimension: string; x: number; y: number; z: number }; at: string }>;
  running: boolean;
  max: { side: number; pieces: number };
};

const WORLD = (d: string) => (d === "minecraft:overworld" ? "the main world" : d.replace(/^deepslate:frontier_/, "the Frontier of "));

function Num({ name, label }: { name: string; label: string }) {
  return (
    <div>
      <Label htmlFor={`b-${name}`}>{label}</Label>
      <Input id={`b-${name}`} name={name} type="number" step={1} required className="mt-1 h-9 w-24 text-sm" />
    </div>
  );
}

function Worlds({ id, frontiers }: { id: string; frontiers: string[] }) {
  return (
    <div>
      <Label htmlFor={id}>World</Label>
      <select id={id} name="dimension" className={cn("mt-1 h-9 text-sm", fieldClasses)}>
        <option value="minecraft:overworld">Main world</option>
        {frontiers.map((d) => <option key={d} value={d}>{WORLD(d)}</option>)}
      </select>
    </div>
  );
}

/**
 * docs/34 §10: take something that stands in the world and use it again. Capture keeps a copy under a name; Place
 * puts a kept build somewhere and can lock its ground. Coordinates are read off F3 in the game.
 */
export function BuildsCard({ view, frontiers }: { view: BuildsView | null; frontiers: string[] }) {
  if (!view) return null;
  return (
    <Card data-testid="season-builds">
      <CardHeader>
        <CardTitle>Builds</CardTitle>
        <CardDescription>
          Keep a copy of something that has been built, and put it somewhere else: a temple at spawn, the same one in the Frontier. Stand at two opposite corners in the game and read the numbers off F3 (&quot;Block&quot;).
          {!view.running && <> <strong>The server is not running:</strong> start it first.</>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <form action={buildCaptureAction} className="space-y-2">
          <p className="font-medium">Capture a build</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="b-name">Name</Label>
              <Input id="b-name" name="name" required pattern="[a-z0-9_]{2,24}" placeholder="boss_temple" className="mt-1 h-9 w-40 text-sm" />
            </div>
            <Worlds id="b-cap-world" frontiers={frontiers} />
            <Num name="x1" label="Corner 1: X" /><Num name="y1" label="Y" /><Num name="z1" label="Z" />
            <Num name="x2" label="Corner 2: X" /><Num name="y2" label="Y" /><Num name="z2" label="Z" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2"><Check type="checkbox" name="sure" /> I&apos;m sure</label>
            <Button type="submit" size="sm" disabled={!view.running}>Capture</Button>
          </div>
          <p className="text-muted-foreground">Up to {view.max.side} blocks a side. Chests are copied with what is in them, so empty them first; animals and mobs are left out. The two blocks straight above the lowest corner&apos;s column are used for a moment and left as air. A name used before is overwritten.</p>
        </form>

        <form action={buildPlaceAction} className="space-y-2">
          <p className="font-medium">Place a build</p>
          {view.builds.length === 0 ? <p className="text-muted-foreground">Nothing has been captured yet.</p> : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <Label htmlFor="b-pick">Build</Label>
                  <select id="b-pick" name="name" required className={cn("mt-1 h-9 text-sm", fieldClasses)}>
                    {view.builds.map((b) => <option key={b.name} value={b.name}>{b.name} · {b.size.x}×{b.size.y}×{b.size.z}</option>)}
                  </select>
                </div>
                <Worlds id="b-place-world" frontiers={frontiers} />
                <Num name="x" label="Lowest corner: X" /><Num name="y" label="Y" /><Num name="z" label="Z" />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2"><Check type="checkbox" name="lock" defaultChecked /> Lock its ground (nobody can break or place blocks there)</label>
                <label className="flex items-center gap-2"><Check type="checkbox" name="sure" /> I&apos;m sure</label>
                <Button type="submit" size="sm" disabled={!view.running}>Place</Button>
              </div>
              <p className="text-muted-foreground">It replaces whatever stands there, and there is no undo: capture the spot first if it matters. The position is the build&apos;s lowest north-west corner (smallest X, Y and Z).</p>
              <ul className="text-muted-foreground">
                {view.builds.map((b) => <li key={b.name}><span className="font-mono text-foreground">{b.name}</span>: {b.size.x} by {b.size.y} by {b.size.z}, from {WORLD(b.from.dimension)} at {b.from.x} {b.from.y} {b.from.z}, {ukShort(new Date(b.at))}</li>)}
              </ul>
            </>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
