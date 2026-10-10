import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check } from "@/components/ui/check";
import { Input, Label, fieldClasses } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ukShort } from "@/lib/uk-time";
import { buildCaptureAction, buildLockAction, buildPlaceAction, buildRemoveAction, buildUploadAction, builderModeAction } from "./actions";
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

function Num({ name, label, id = `b-${name}` }: { name: string; label: string; id?: string }) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type="number" step={1} required className="mt-1 h-9 w-24 text-sm" />
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
export function BuildsCard({ view, files = [], frontiers, mods = {}, builder = null, designed = [] }: { view: BuildsView | null; files?: StoredBuild[]; frontiers: string[]; /** docs/39: uploads that were kept from a design, linked back to its versions. */ designed?: string[]; /** dist/pack-blocks.json: the mods' names by namespace. */ mods?: Record<string, string>; /** docs/37: the admin's Builder tools, when ticked. */ builder?: { mcUsername: string | null } | null }) {
  if (!view) return null;
  const ready = new Map((view.uploads ?? []).map((u) => [u.name, u]));
  const problems = new Map((view.problems ?? []).map((p) => [p.file, p.why]));
  return (
    <Card id="builds" data-testid="season-builds">
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
              <Input id="b-name" name="name" required maxLength={60} placeholder="Boss temple" className="mt-1 h-9 w-40 text-sm" />
            </div>
            <Worlds id="b-cap-world" frontiers={frontiers} />
            <Num name="x1" label="Corner 1: X" /><Num name="y1" label="Y" /><Num name="z1" label="Z" />
            <Num name="x2" label="Corner 2: X" /><Num name="y2" label="Y" /><Num name="z2" label="Z" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2"><Check type="checkbox" name="sure" /> I&apos;m sure</label>
            <Button type="submit" size="sm" disabled={!view.running}>Capture</Button>
          </div>
          <p className="text-muted-foreground">Up to {view.max.side} blocks a side. Chests are copied with what is in them, so empty them first; animals and mobs are left out. The two blocks straight above the lowest corner&apos;s column are used for a moment and left as air. Any name will do: &quot;Boss Temple&quot; is kept as boss_temple. A name used before is overwritten.</p>
        </form>

        <div className="space-y-2">
          <p className="font-medium">Upload a build</p>
          <form action={buildUploadAction} className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="b-up-name">Name</Label>
              <Input id="b-up-name" name="name" maxLength={60} placeholder="Sky temple" className="mt-1 h-9 w-40 text-sm" />
            </div>
            <div>
              <Label htmlFor="b-up-file">File (.litematic, .schem or .nbt)</Label>
              <input id="b-up-file" name="file" type="file" accept=".litematic,.schem,.nbt" required className="mt-1 block text-xs file:mr-2 file:rounded file:border file:bg-card-2 file:px-2 file:py-1 file:text-foreground" />
            </div>
            <label className="flex h-9 items-center gap-2"><Check type="checkbox" name="allowMissing" /> The missing blocks become air</label>
            <Button type="submit" size="sm" variant="secondary">Upload</Button>
          </form>
          <p className="text-muted-foreground">Any name will do (&quot;Sky Temple&quot; is kept as sky_temple); left empty, the file&apos;s own name. The file is read as you upload it: you see how big it is and which mods its blocks come from. One with blocks from a mod we don&apos;t have is turned away and the blocks are named; tick <strong>The missing blocks become air</strong> to take it anyway, with holes where they were. {Object.keys(mods).length === 0 && <>No Build has run yet, so the mods are listed but not checked. </>}Then press <strong>Build</strong> and <strong>Sync</strong> on the Modpack page; after the server&apos;s next restart (or a reload of its datapacks) it can be placed. Up to 256 blocks a side and 8 MB. Not taken: the old .schematic; open it in the game and save it again with a structure block.</p>
          {files.length > 0 && (
            <ul className="divide-y">
              {files.map((f) => {
                const on = ready.get(f.name);
                const why = problems.get(`${f.name}.${f.format}`);
                return (
                  <li key={f.name} className="flex flex-wrap items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="font-mono">{f.name}</span>{designed.includes(f.name) && <> <a href={`/admin/builds?design=${f.name}#design`} className="text-xs text-primary underline">designed</a></>} <span className="text-muted-foreground">.{f.format}, {Math.max(1, Math.round(f.bytes / 1024))} KB, {ukShort(f.at)}
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

        <div className="space-y-2" data-testid="builder-mode">
          <p className="font-medium">Place it where you stand (WorldEdit)</p>
          {!builder ? (
            <p className="text-muted-foreground">For admins with <strong>Builder tools</strong>, which an admin gives on People (a row&apos;s menu). Builder mode puts you in creative, the only way WorldEdit works on our server.</p>
          ) : !builder.mcUsername ? (
            <p className="text-muted-foreground">You have Builder tools, but no Minecraft account is linked to you yet.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <form action={builderModeAction}><input type="hidden" name="on" value="1" /><Button type="submit" size="sm" disabled={!view.running}>Builder mode on</Button></form>
                <form action={builderModeAction}><input type="hidden" name="on" value="0" /><Button type="submit" size="sm" variant="secondary" disabled={!view.running}>Builder mode off</Button></form>
                <span className="text-muted-foreground">for <span className="font-mono">{builder.mcUsername}</span>, who must be on the server</span>
              </div>
              <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
                <li>Switch Builder mode on: you are in creative.</li>
                <li>Stand where the build&apos;s corner should be (its lowest north-west corner lands on your feet) and type <span className="font-mono text-foreground">{`//schem load ${ready.size ? [...ready.keys()][0] : "name"}`}</span>.</li>
                <li><span className="font-mono text-foreground">{"//rotate 90"}</span> to turn it first if you want, then <span className="font-mono text-foreground">{"//paste -a"}</span> (<span className="font-mono">-a</span> leaves its air out, so it doesn&apos;t dig into the ground).</li>
                <li>Not right? <span className="font-mono text-foreground">{"//undo"}</span>, move, and paste again. Then lock its ground below if it is to stay, and switch Builder mode off.</li>
              </ol>
              <p className="text-muted-foreground">WorldEdit has every upload that has been through <strong>Build</strong> and <strong>Sync</strong>, by its name. A removed upload stays in WorldEdit&apos;s list until it is deleted from the server&apos;s config/worldedit/schematics.</p>
            </>
          )}
          <form action={buildLockAction} className="space-y-2 pt-1">
            <p className="text-muted-foreground">Lock the ground of something placed with WorldEdit: two opposite corners, read off F3.</p>
            <div className="flex flex-wrap items-end gap-3">
              <Worlds id="b-lock-world" frontiers={frontiers} />
              <Num name="x1" id="b-lock-x1" label="Corner 1: X" /><Num name="z1" id="b-lock-z1" label="Z" />
              <Num name="x2" id="b-lock-x2" label="Corner 2: X" /><Num name="z2" id="b-lock-z2" label="Z" />
              <Button type="submit" size="sm" variant="secondary" disabled={!view.running}>Lock its ground</Button>
            </div>
          </form>
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
