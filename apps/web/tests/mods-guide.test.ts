import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GUIDE_TOPICS, manifestSchema } from "modpack/schema";
import { guideParts, matches, searchText, type ExtraEntry } from "../src/lib/mods-guide";

const mod = (o: Record<string, unknown>) => ({ category: "base", side: "both", enabled: true, load: "L", recommended: false, hidden: false, exclusiveGroup: null, description: "d", wiki: "https://w", videos: [], version: "latest", requires: [], keys: [], ...o }) as never;

describe("the Mods guide", () => {
  const m = {
    mods: [
      mod({ slug: "create", name: "Create", guide: "game", topic: "factories", howTo: "Start with a water wheel.", keys: [{ key: "W", does: "Ponder in JEI" }], videos: [{ title: "v", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }] }),
      mod({ slug: "jei", name: "JEI", guide: "helper", howTo: "Press R." }),
      mod({ slug: "lithium", name: "Lithium", guide: "behind" }),
      mod({ slug: "spark", name: "spark", guide: "behind", side: "server" }),
      mod({ slug: "mekanism", name: "Mekanism", guide: "game", topic: "factories", enabled: false }),
      mod({ slug: "sophisticated-core", name: "Core", guide: "behind", hidden: true }),
    ],
  };
  const extras: ExtraEntry[] = [{ id: "iris", name: "Iris", description: "Shaders", howTo: "Switch it on in the app.", projects: [{ slug: "iris" }] }];

  it("puts each switched-on mod in its part, extras in theirs, and folds the last one", () => {
    const parts = guideParts(m, extras, { create: "https://cdn/create.png" }, { iris: "data:image/png;base64,x" });
    expect(parts.map((p) => [p.key, p.cards.map((c) => c.id), p.collapsed])).toEqual([
      ["topic-factories", ["create"], false],
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
  it("lists an admin-only mod (the coming season's) to admins only, and says so on its card", () => {
    const withSeason = { mods: [...m.mods, mod({ slug: "l_enders-cataclysm", name: "Cataclysm", guide: "game", topic: "bosses", howTo: "Find a dungeon.", adminOnly: true })] };
    const ids = (admin: boolean) => guideParts(withSeason, [], {}, {}, admin).flatMap((p) => p.cards.map((c) => c.id));
    expect(ids(false)).not.toContain("l_enders-cataclysm");
    expect(ids(true)).toContain("l_enders-cataclysm");
    const game = guideParts(withSeason, [], {}, {}, true).filter((p) => p.key.startsWith("topic-"));
    expect(game.map((p) => [p.key, p.cards.map((c) => [c.id, c.adminOnly])])).toEqual([["topic-factories", [["create", false]]], ["topic-bosses", [["l_enders-cataclysm", true]]]]);
    // a part holding only admin-only mods is left out for a player
    expect(guideParts({ mods: [withSeason.mods.at(-1)!] }, []).length).toBe(0);
  });
  it("searches names, text and keys", () => {
    const create = guideParts(m, [])[0]!.cards[0]!;
    expect(matches(searchText(create), "water wheel")).toBe(true);
    expect(matches(searchText(create), "ponder")).toBe(true);
    expect(matches(searchText(create), "")).toBe(true);
    expect(matches(searchText(create), "shaders")).toBe(false);
  });

  // docs/52: "What's in the game" is a section per topic
  describe("by topic", () => {
    const game = (slug: string, topic: string, o: Record<string, unknown> = {}) => mod({ slug, name: slug, guide: "game", topic, howTo: "h", ...o });

    it("puts each mod in its topic's section, in GUIDE_TOPICS order, then helper, extras and behind", () => {
      const parts = guideParts({ mods: [game("farm", "farming"), m.mods[2]!, game("map", "travel"), m.mods[1]!, game("drill", "mining"), game("boss", "bosses")] }, extras);
      expect(parts.map((p) => [p.key, p.anchor, p.cards.map((c) => c.id)])).toEqual([
        ["topic-travel", "topic-travel", ["map"]],
        ["topic-mining", "topic-mining", ["drill"]],
        ["topic-farming", "topic-farming", ["farm"]],
        ["topic-bosses", "topic-bosses", ["boss"]],
        ["helper", "part-helper", ["jei"]],
        ["extras", "part-extras", ["iris"]],
        ["behind", "part-behind", ["lithium"]],
      ]);
      expect(parts.map((p) => p.title).slice(0, 4)).toEqual(["Getting around", "Mining and gathering", "Farming and food", "Bosses and trials"]);
      expect(GUIDE_TOPICS[0]).toBe("travel");
    });
    it("leaves out a section whose mods are all switched off, or all admin-only for a player; an admin sees it", () => {
      const mods = { mods: [game("map", "travel"), game("cannon", "combat", { enabled: false }), game("boss-a", "bosses", { adminOnly: true }), game("boss-b", "bosses", { adminOnly: true })] };
      expect(guideParts(mods, []).map((p) => p.key)).toEqual(["topic-travel"]);
      expect(guideParts(mods, [], {}, {}, true).map((p) => [p.key, p.cards.map((c) => c.id)])).toEqual([["topic-travel", ["map"]], ["topic-bosses", ["boss-a", "boss-b"]]]);
    });
    it("a \"game\" mod without a topic (an older mods.json) is not lost: it shows under What's in the game", () => {
      const parts = guideParts({ mods: [game("map", "travel"), mod({ slug: "old", name: "Old", guide: "game", howTo: "h" }), m.mods[1]!] }, []);
      expect(parts.map((p) => [p.key, p.anchor, p.cards.map((c) => c.id)])).toEqual([["topic-travel", "topic-travel", ["map"]], ["game", "part-game", ["old"]], ["helper", "part-helper", ["jei"]]]);
    });
    it("keeps mods.json order inside a section", () => {
      const parts = guideParts({ mods: [game("zeta", "building"), game("alpha", "building"), game("mid", "travel"), game("beta", "building")] }, []);
      expect(parts.find((p) => p.key === "topic-building")!.cards.map((c) => c.id)).toEqual(["zeta", "alpha", "beta"]);
    });
    it("the real mods.json, as a player: no card is lost from what the one \"game\" part held", () => {
      const real = manifestSchema.parse(JSON.parse(readFileSync(new URL("../../../modpack/mods.json", import.meta.url), "utf8")));
      // the old "game" part: switched on, not a dependency, not admin-only, guide "game"
      const before = real.mods.filter((x) => x.enabled && !x.hidden && !x.adminOnly && x.guide === "game").map((x) => x.slug);
      const all = guideParts(real, []);
      expect(all.some((p) => p.key === "game")).toBe(false); // every one has its topic
      const sections = all.filter((p) => p.key.startsWith("topic-"));
      const after = sections.flatMap((p) => p.cards.map((c) => c.id));
      expect(before.length).toBeGreaterThan(0);
      expect([...after].sort()).toEqual([...before].sort());
      expect(new Set(after).size).toBe(after.length);
      expect(sections.map((p) => p.key)).toEqual(GUIDE_TOPICS.map((t) => `topic-${t}`).filter((k) => sections.some((p) => p.key === k)));
    });
  });

  it("the search box's browser code carries none of the guide's text (a hidden section's title stays on the server)", () => {
    const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
    const box = src("components/mods-guide/search.tsx");
    expect(box).not.toMatch(/from "@\/lib\/mods-guide"|from "modpack/);
    expect(box).toMatch(/from "@\/lib\/mods-search"/);
    expect(src("lib/mods-search.ts")).not.toMatch(/^import /m);
  });
});
