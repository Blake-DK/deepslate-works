import { describe, expect, it } from "vitest";
import { actions, BOOK_TAG, KIT_TAG, parsePlace, RELEASED_TAG } from "../src/actions/registry.js";

// docs/25 (2026-10-08): in the entrance room someone never let out holds the sign-in book and nothing else; someone let
// out before keeps everything they carry. The kit itself is the datapack's (packages/modpack/tests/datapack.test.ts).

const ctx = { limbo: parsePlace("deepslate:limbo 0.5 65 0.5"), spawn: null, portalUrl: "https://deepslate.dsw.test" };
const BOOK = "minecraft:written_book";

type Player = { name: string; tags: Set<string>; inventory: string[]; mainhand: string | null };

// Just enough of the game to run the room's commands that touch tags and the inventory.
function selects(sel: string, p: Player): boolean {
  if (sel === p.name) return true;
  const m = /^@a\[(.*)\]$/.exec(sel);
  if (!m) return false;
  return m[1]!.split(",").every((arg) => {
    const [k, v] = arg.split("=") as [string, string];
    if (k === "name") return v === p.name;
    if (k === "tag") return v.startsWith("!") ? !p.tags.has(v.slice(1)) : p.tags.has(v);
    return true;
  });
}
function run(cmds: string[], p: Player) {
  for (const c of cmds) {
    let m: RegExpExecArray | null;
    if ((m = /^tag (\S+) (add|remove) (\S+)$/.exec(c))) {
      if (!selects(m[1]!, p)) continue;
      if (m[2] === "add") p.tags.add(m[3]!);
      else p.tags.delete(m[3]!);
    } else if ((m = /^clear (\S+)(?: (\S+))?$/.exec(c))) {
      if (!selects(m[1]!, p)) continue;
      if (!m[2]) { p.inventory = []; p.mainhand = null; continue; } // the whole inventory
      const ours = (i: string | null) => i !== null && i.includes(`${BOOK_TAG}:1b`);
      p.inventory = p.inventory.filter((i) => !ours(i));
      if (ours(p.mainhand)) p.mainhand = null;
    } else if ((m = /^execute as (\S+) (if|unless) items entity @s weapon\.mainhand \* run (give @s|item replace entity @s weapon\.mainhand with) (.+)$/.exec(c))) {
      if (!selects(m[1]!, p) || (m[2] === "if") !== (p.mainhand !== null)) continue;
      if (m[3] === "give @s") p.inventory.push(m[4]!);
      else p.mainhand = m[4]!;
    }
  }
}
const player = (name: string, tags: string[], inventory: string[], mainhand: string | null = null): Player => ({ name, tags: new Set(tags), inventory, mainhand });
const items = (p: Player) => [p.mainhand, ...p.inventory].filter((i): i is string => i !== null).map((i) => i.split("[")[0]);
const hold = (p: Player) => run(actions["limbo.hold"].build(ctx, { name: p.name, code: "ABC234" }), p);
const release = (p: Player) => run(actions["link.release"].build(ctx, { name: p.name }), p);

describe("the kit decision in the entrance room (docs/25, 2026-10-08)", () => {
  it("never let out: the book and nothing else, whatever they arrived with", () => {
    const p = player("Bramble09", [], ["minecraft:stone_pickaxe", "minecraft:bread"]);
    hold(p);
    expect(items(p)).toEqual([BOOK]);
    expect(p.tags.has(RELEASED_TAG)).toBe(false);
  });
  it("let out before and held again (back from a restart, still verified): everything kept, the book added, marked", () => {
    const p = player("m1_owl", ["verified", KIT_TAG], ["minecraft:diamond_pickaxe", "sophisticatedbackpacks:backpack"], "minecraft:torch");
    hold(p);
    expect(items(p)).toEqual(["minecraft:torch", "minecraft:diamond_pickaxe", "sophisticatedbackpacks:backpack", BOOK]);
    expect([...p.tags].sort()).toEqual([KIT_TAG, RELEASED_TAG].sort());
  });
  it("revoked (no verified any more) but carrying the mark: nothing cleared", () => {
    for (const mark of [RELEASED_TAG, KIT_TAG]) {
      const p = player("samoyedx", [mark], ["minecraft:iron_sword"]);
      hold(p);
      expect(items(p)).toEqual([BOOK, "minecraft:iron_sword"]);
    }
  });
  it("release takes the book back and nothing else, then marks them; a second hold and release keep all they have", () => {
    const p = player("KaneFinch", [], []);
    hold(p);
    release(p);
    expect(items(p)).toEqual([]);
    expect(p.tags.has("verified")).toBe(true);
    p.tags.add(KIT_TAG); // the datapack's tick, one tick later (and RELEASED_TAG with it)
    p.tags.add(RELEASED_TAG);
    p.inventory.push("minecraft:stone_sword", "minecraft:bread");
    hold(p);
    release(p);
    expect(items(p)).toEqual(["minecraft:stone_sword", "minecraft:bread"]);
  });
  it("the whole-inventory clear is aimed only at someone held with neither mark", () => {
    const clears = actions["limbo.hold"].build(ctx, { name: "Rowan", code: "ABC234" }).filter((c) => /^clear \S+$/.test(c));
    expect(clears).toEqual([`clear @a[name=Rowan,tag=!verified,tag=!${RELEASED_TAG},tag=!${KIT_TAG}]`]);
    for (const a of ["link.release", "limbo.releaseBack"] as const) {
      const cmds = actions[a].build(ctx, { name: "Rowan", back: null } as never);
      expect(cmds.filter((c) => /^clear \S+$/.test(c))).toEqual([]);
    }
  });
  it("a full inventory gets no book on the floor: any copy dropped near them is taken away", () => {
    const give = actions["limbo.giveBook"].build(ctx, { name: "owly", code: "ABC234" });
    expect(give.at(-1)).toBe(`execute as @a[name=owly,tag=!verified] at @s run kill @e[type=minecraft:item,distance=..4,nbt={Item:{components:{"minecraft:custom_data":{${BOOK_TAG}:1b}}}}]`);
  });
});
