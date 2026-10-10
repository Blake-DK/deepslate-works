"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { blockCounts, compileGrid, parseRecipe, picture, render, type BlockList, type Recipe } from "modpack/design";
import { Button } from "@/components/ui/button";

// docs/39 Step 2: the picture of a design, drawn here in the browser from its recipe with the same code the Step 0
// command uses: an angled view, four turns, and a slider that cuts the build floor by floor.

const SIDES = ["south and east", "east and north", "north and west", "west and south"];

export function DesignPicture({ recipe, blocks }: { recipe: Recipe; blocks: BlockList }) {
  const built = useMemo(() => {
    try {
      const grid = compileGrid(parseRecipe(recipe, blocks), blocks);
      return { grid, counts: blockCounts(grid) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [recipe, blocks]);
  const [turn, setTurn] = useState(0);
  const [cut, setCut] = useState(recipe.size.y); // size.y: the whole build
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => setCut(recipe.size.y), [recipe]);

  useEffect(() => {
    if (!("grid" in built) || !built.grid || !canvas.current) return;
    const { x, z } = recipe.size;
    const tile = Math.min(24, Math.max(4, Math.floor(720 / (x + z) / 2) * 2));
    const img = render(picture(built.grid, blocks, cut >= recipe.size.y ? Infinity : cut), { turn, tile });
    const c = canvas.current;
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
  }, [built, blocks, recipe, turn, cut]);

  if ("error" in built) return <p className="text-sm text-danger">The picture cannot be drawn: {built.error}</p>;
  const placed = built.counts.reduce((n, c) => n + c.count, 0);
  return (
    <div className="space-y-2">
      <canvas ref={canvas} className="block h-auto max-w-full border border-edge [image-rendering:pixelated]" aria-label={`The build seen from the ${SIDES[turn]}`} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button type="button" size="sm" variant="secondary" onClick={() => setTurn((t) => (t + 3) % 4)}>↺ Turn</Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setTurn((t) => (t + 1) % 4)}>↻ Turn</Button>
        <span className="text-muted-foreground">seen from the {SIDES[turn]}</span>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span>Cut it at</span>
        <input type="range" min={recipe.ground} max={recipe.size.y} value={cut} onChange={(e) => setCut(Number(e.target.value))} className="w-56" />
        <span className="text-muted-foreground">{cut >= recipe.size.y ? "the whole build" : `layer ${cut} (${cut - recipe.ground} above the floor)`}</span>
      </label>
      <p className="text-xs text-muted-foreground">
        {placed.toLocaleString("en-GB")} blocks: {built.counts.slice(0, 6).map((c) => `${c.block.replace(/^minecraft:/, "")} ${c.count.toLocaleString("en-GB")}`).join(", ")}{built.counts.length > 6 ? ", …" : ""}. The darker layers are the foundation, under the ground; magenta dots are markers.
      </p>
    </div>
  );
}
