import { paletteEntry } from "./builds";
import { compileGrid, type BlockList, type DesignGrid, type Recipe } from "./design";
import { compound, int, ints, list, type Tag } from "./nbt";

// docs/39: a compiled design as the game's structure file. Apart from design.ts, which the browser runs too.

/** A grid as the game's structure file (the same Tag builds.ts writes). A place no step wrote is left out. */
export function gridToStructure(grid: DesignGrid): Tag {
  const { x: sx, y: sy, z: sz } = grid.size;
  const used = new Set<number>();
  for (const c of grid.cells) if (c >= 0) used.add(c);
  const order = [...used].sort((a, b) => a - b);
  const renumber = new Map(order.map((c, i) => [c, i]));
  const blocks: Tag[] = [];
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const c = grid.cells[x + sx * (z + sz * y)]!;
    if (c >= 0) blocks.push(compound({ pos: ints([x, y, z]), state: int(renumber.get(c)!) }));
  }
  return compound({
    DataVersion: int(3955), // 1.21.1
    size: ints([sx, sy, sz]),
    palette: list(10, order.map((c) => paletteEntry(grid.palette[c]!))),
    blocks: list(10, blocks),
    entities: list(10, []),
  });
}

/** A checked recipe as the game's structure file, and its grid for the picture. */
export function compile(recipe: Recipe, blocks: BlockList): { structure: Tag; grid: DesignGrid; blocks: number } {
  const grid = compileGrid(recipe, blocks);
  const structure = gridToStructure(grid);
  let n = 0;
  for (const c of grid.cells) if (c > 0) n++;
  return { structure, grid, blocks: n };
}
