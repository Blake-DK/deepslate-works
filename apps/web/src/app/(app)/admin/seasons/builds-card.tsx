import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check } from "@/components/ui/check";
import { Input, Label, fieldClasses } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ukShort } from "@/lib/uk-time";
import { buildCaptureAction, buildPlaceAction, buildRemoveAction, buildUploadAction } from "./actions";
import type { StoredBuild } from "@/server/builds";

export type BuildsView = {
  builds: Array<{ name: string; size: { x: number; y: number; z: number }; from: { dimension: string; x: number; y: number; z: number }; at: string }>;
  /** Uploads the last Build put into the datapack, with their sizes; and the files it could not read. */
  uploads?: Array<{ name: string; format: string; size: { x: number; y: number; z: number }; missing?: string[]; airFor?: number }>;
  problems?: Array<{ file: string; why: string }>;
  running: boolean;
  max: { side: number; pieces: number };
};

/** Where builds can be had. Each site has its own rules on using what is shared there; credit the builder. */
const SITES = [
  { name: "Planet Minecraft", url: "https://www.planetminecraft.com/projects/", note: "the largest; pick projects that offer a schematic download, most of them .litematic" },
  { name: "Abfielder", url: "https://abfielder.com/", note: "builds with .schem downloads, many of them temples and halls" },
  { name: "Create schematics", url: "https://createmod.com/schematics", note: ".nbt files made with Create, and often with Create add-ons we don't have: the check on upload says which" },
];

/** "Create (120), Copycats (4)": the mods a build's blocks come from, besides Minecraft's own. */
function needsLine(note: NonNullable<StoredBuild["note"]>, mods: Record<string, string>) {
  const other = note.check.needs.filter((n) => n.namespace !== "minecraft");
  if (other.length === 0) return "Minecraft's own blocks only";
  return `blocks from ${other.map((n) => `${mods[n.namespace] ?? n.namespace} (${n.blocks.toLocaleString("en-GB")})`).join(", ")}`;
}

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
export function BuildsCard({ view, files = [], frontiers, mods = {} }: { view: BuildsView | null; files?: StoredBuild[]; frontiers: string[]; /** dist/pack-blocks.json: the mods' names by namespace. */ mods?: Record<string, string> }) {
  if (!view) return null;
  const ready = new Map((view.uploads ?? []).map((u) => [u.name, u]));
  const problems = new Map((view.problems ?? []).map((p) => [p.file, p.why]));
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

        <div className="space-y-2">
          <p className="font-medium">Upload a build</p>
          <form action={buildUploadAction} className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="b-up-name">Name</Label>
              <Input id="b-up-name" name="name" required pattern="[a-z0-9_]{2,24}" placeholder="sky_temple" className="mt-1 h-9 w-40 text-sm" />
            </div>
            <div>
              <Label htmlFor="b-up-file">File (.litematic, .schem or .nbt)</Label>
              <input id="b-up-file" name="file" type="file" accept=".litematic,.schem,.nbt" required className="mt-1 block text-xs file:mr-2 file:rounded file:border file:bg-card-2 file:px-2 file:py-1 file:text-foreground" />
            </div>
            <label className="flex h-9 items-center gap-2"><Check type="checkbox" name="allowMissing" /> The missing blocks become air</label>
            <Button type="submit" size="sm" variant="secondary">Upload</Button>
          </form>
          <p className="text-muted-foreground">The file is read as you upload it: you see how big it is and which mods its blocks come from. One with blocks from a mod we don&apos;t have is turned away and the blocks are named; tick <strong>The missing blocks become air</strong> to take it anyway, with holes where they were. {Object.keys(mods).length === 0 && <>No Build has run yet, so the mods are listed but not checked. </>}Then press <strong>Build</strong> and <strong>Sync</strong> on the Modpack page; after the server&apos;s next restart (or a reload of its datapacks) it can be placed. Up to 256 blocks a side and 8 MB. Not taken: the old .schematic; open it in the game and save it again with a structure block.</p>
          {files.length > 0 && (
            <ul className="divide-y">
              {files.map((f) => {
                const on = ready.get(f.name);
                const why = problems.get(`${f.name}.${f.format}`);
                return (
                  <li key={f.name} className="flex flex-wrap items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="font-mono">{f.name}</span> <span className="text-muted-foreground">.{f.format}, {Math.max(1, Math.round(f.bytes / 1024))} KB, {ukShort(f.at)}
                        {f.note && <> · {f.note.check.size.x} by {f.note.check.size.y} by {f.note.check.size.z}, {needsLine(f.note, mods)}</>}
                        {f.note && f.note.check.missing.length > 0 && <> · <span className="text-warn">{f.note.check.missing.map((ns) => mods[ns] ?? ns).join(", ")} not in the pack: those blocks will be air</span></>}
                        {" · "}{why ? <span className="text-danger">Build left it out: {why}</span> : on ? `built${on.airFor ? `, ${on.airFor.toLocaleString("en-GB")} blocks made air` : ""}` : "not built yet"}</span>
                    </span>
                    <form action={buildRemoveAction}><input type="hidden" name="name" value={f.name} /><Button type="submit" size="sm" variant="secondary">Remove</Button></form>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-muted-foreground">Where to find builds: {SITES.map((s, i) => <span key={s.url}>{i > 0 && "; "}<a href={s.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{s.name}</a> ({s.note})</span>)}. Check what the builder allows before you use one, and say whose it is.</p>
        </div>

        <form action={buildPlaceAction} className="space-y-2">
          <p className="font-medium">Place a build</p>
          {view.builds.length === 0 && ready.size === 0 ? <p className="text-muted-foreground">Nothing has been captured or built yet.</p> : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <Label htmlFor="b-pick">Build</Label>
                  <select id="b-pick" name="name" required className={cn("mt-1 h-9 text-sm", fieldClasses)}>
                    {view.builds.map((b) => <option key={`c:${b.name}`} value={`c:${b.name}`}>{b.name} · {b.size.x}×{b.size.y}×{b.size.z} (captured)</option>)}
                    {[...ready.values()].map((b) => <option key={`u:${b.name}`} value={`u:${b.name}`}>{b.name} · {b.size.x}×{b.size.y}×{b.size.z} (uploaded)</option>)}
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
