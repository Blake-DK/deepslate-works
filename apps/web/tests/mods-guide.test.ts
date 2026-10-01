import { describe, expect, it } from "vitest";
import { guideParts, matches, searchText, type ExtraEntry } from "../src/lib/mods-guide";

const mod = (o: Record<string, unknown>) => ({ category: "base", side: "both", enabled: true, load: "L", recommended: false, hidden: false, exclusiveGroup: null, description: "d", wiki: "https://w", videos: [], version: "latest", requires: [], keys: [], ...o }) as never;

describe("the Mods guide", () => {
  const m = {
    mods: [
      mod({ slug: "create", name: "Create", guide: "game", howTo: "Start with a water wheel.", keys: [{ key: "W", does: "Ponder in JEI" }], videos: [{ title: "v", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }] }),
      mod({ slug: "jei", name: "JEI", guide: "helper", howTo: "Press R." }),
      mod({ slug: "lithium", name: "Lithium", guide: "behind" }),
      mod({ slug: "spark", name: "spark", guide: "behind", side: "server" }),
      mod({ slug: "mekanism", name: "Mekanism", guide: "game", enabled: false }),
      mod({ slug: "sophisticated-core", name: "Core", guide: "behind", hidden: true }),
    ],
  };
  const extras: ExtraEntry[] = [{ id: "iris", name: "Iris", description: "Shaders", howTo: "Switch it on in the app.", projects: [{ slug: "iris" }] }];

  it("puts each switched-on mod in its part, extras in theirs, and folds the last one", () => {
    const parts = guideParts(m, extras, { create: "https://cdn/create.png" }, { iris: "data:image/png;base64,x" });
    expect(parts.map((p) => [p.key, p.cards.map((c) => c.id), p.collapsed])).toEqual([
      ["game", ["create"], false],
      ["helper", ["jei"], false],
      ["extras", ["iris"], false],
      ["behind", ["lithium", "spark"], true],
    ]);
    const create = parts[0]!.cards[0]!;
    expect(create).toMatchObject({ where: "everyone", icon: "https://cdn/create.png", howTo: "Start with a water wheel.", video: { title: "v" } });
    expect(parts[2]!.cards[0]).toMatchObject({ where: "optional", icon: "data:image/png;base64,x", wiki: "https://modrinth.com/project/iris" });
    expect(parts[3]!.cards[1]!.where).toBe("server");
  });
  it("leaves out empty parts", () => {
    expect(guideParts({ mods: [m.mods[2]!] }, []).map((p) => p.key)).toEqual(["behind"]);
  });
  it("searches names, text and keys", () => {
    const create = guideParts(m, [])[0]!.cards[0]!;
    expect(matches(searchText(create), "water wheel")).toBe(true);
    expect(matches(searchText(create), "ponder")).toBe(true);
    expect(matches(searchText(create), "")).toBe(true);
    expect(matches(searchText(create), "shaders")).toBe(false);
  });
});
