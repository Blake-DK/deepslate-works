import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allowed, filterGuide, gettingIn, section } from "@/lib/guide";
import { DEFAULT_GUIDE } from "@/lib/guide-default";
import { markdown } from "@/lib/markdown";

const mods = (...slugs: string[]) => ({ mods: new Set(slugs) });

describe("filterGuide", () => {
  const src = [
    "## Basics",
    "",
    "- **JEI**: press R.",
    "- **Waystones**: click one. <!-- mod: waystones -->",
    "- **VeinMiner**: hold the key",
    "  while breaking ore. <!-- mod: veinminer -->",
    "- **Jade**: look at things.",
    "",
    "## Power and machines <!-- mod: create -->",
    "",
    "Create is the factory mod.",
    "",
    "### Trains",
    "",
    "Later.",
    "",
    "## Electricity <!-- mod: createaddition -->",
    "",
    "Alternators.",
    "",
    "## Rules",
    "",
    "A paragraph about guns",
    "that runs over two lines. <!-- mod: tacz-1.21.1 -->",
    "",
    "Be nice. <!-- a note to self -->",
  ].join("\n");

  it("leaves out what is about a mod that is not switched on", () => {
    const out = filterGuide(src, mods());
    expect(out).toBe(["## Basics", "", "- **JEI**: press R.", "- **Jade**: look at things.", "", "## Rules", "", "Be nice."].join("\n"));
  });
  it("shows a section, with what is under it, when its mod is on", () => {
    const out = filterGuide(src, mods("create"));
    expect(out).toContain("## Power and machines\n\nCreate is the factory mod.\n\n### Trains\n\nLater.");
    expect(out).not.toContain("Electricity");
    expect(out).not.toContain("Alternators");
  });
  it("shows an item with the lines that continue it, and a whole paragraph", () => {
    const out = filterGuide(src, mods("veinminer", "tacz-1.21.1"));
    expect(out).toContain("- **VeinMiner**: hold the key\n  while breaking ore.");
    expect(out).toContain("A paragraph about guns\nthat runs over two lines.");
    expect(out).not.toContain("Waystones");
  });
  it("never shows a comment", () => {
    expect(filterGuide(src, mods("create", "createaddition", "waystones", "veinminer", "tacz-1.21.1"))).not.toMatch(/<!--|-->/);
  });
  it("a section that is left out takes its sub-sections with it, and ends at the next heading of its rank", () => {
    const out = filterGuide("# A <!-- mod: x -->\ntext\n## A1\nmore\n# B\nkept", mods());
    expect(out).toBe("# B\nkept");
  });
  it("needs every mod named in a tag, and knows the parts of the portal that are not built yet", () => {
    expect(allowed("x <!-- mod: create, createaddition -->", mods("create"))).toBe(false);
    expect(allowed("x <!-- mod: create, createaddition -->", mods("create", "createaddition"))).toBe(true);
    expect(allowed("x <!-- feature: actions -->", mods())).toBe(false);
    expect(allowed("x <!-- feature: actions -->", { mods: new Set(), features: { actions: true } })).toBe(true);
    expect(allowed("x <!-- feature: made-up -->", mods())).toBe(false);
    expect(allowed("no tag", mods())).toBe(true);
  });
});

describe("the guide as it ships", () => {
  const manifest = JSON.parse(readFileSync(path.join(__dirname, "../../../modpack/mods.json"), "utf8")) as { mods: Array<{ slug: string; enabled: boolean }> };
  const slugs = new Set(manifest.mods.map((m) => m.slug));
  const on = new Set(manifest.mods.filter((m) => m.enabled).map((m) => m.slug));

  it("names only mods that are in the mod list", () => {
    const named = [...DEFAULT_GUIDE.matchAll(/<!--\s*mod\s*:\s*([^>]+?)\s*-->/g)].flatMap((m) => m[1]!.split(",").map((s) => s.trim()));
    expect(named.length).toBeGreaterThan(8);
    expect(named.filter((n) => !slugs.has(n))).toEqual([]);
  });
  it("with today's mod list shows the sections of the mods that are on, and no others (docs/18 acceptance)", () => {
    const out = filterGuide(DEFAULT_GUIDE, { mods: on });
    const want: Array<[string, string]> = [["Power and machines", "create"], ["Electricity", "createaddition"], ["The quarry", "additional-enchanted-miner"], ["Pipes", "pipez"], ["Guns", "tacz-1.21.1"]];
    for (const [title, slug] of want) expect([title, out.includes(`## ${title}`)]).toEqual([title, on.has(slug)]);
    expect(out).toContain("## Getting in");
    expect(out).toContain("**JEI**");
    expect(out.includes("**FallingTree**")).toBe(on.has("fallingtree"));
    expect(out).not.toMatch(/<!--/);
    expect(out).not.toContain("Take me to spawn"); // the buttons on the Me page are not built yet
  });
  it("shows Building only while all the suggested building mods are on (planner, 2026-09-30)", () => {
    const building = ["create-deco", "copycats", "macaws-roofs", "macaws-windows", "macaws-doors", "handcrafted"];
    for (const s of building) expect([s, slugs.has(s)]).toEqual([s, true]);
    expect(filterGuide(DEFAULT_GUIDE, { mods: new Set([...on, ...building]) })).toContain("## Building");
    expect(filterGuide(DEFAULT_GUIDE, { mods: new Set([...on, ...building].filter((s) => s !== "handcrafted")) })).not.toContain("## Building");
    expect(filterGuide(DEFAULT_GUIDE, { mods: on })).toContain("you can see 12 chunks on this server");
  });
  it("brings the votable mods' lines back the moment Apply results switches them on", () => {
    // Apply results writes `enabled: true` into mods.json; the guide reads mods.json again whenever the file changes.
    const before = filterGuide(DEFAULT_GUIDE, { mods: on });
    const votable: Array<[string, string[]]> = [
      ["sophisticated-backpacks", ["**Backpacks**", "Craft a backpack as soon as you have leather or wool."]],
      ["waystones", ["**Waystones**", "Find a waystone or build one so you can always get home."]],
      ["veinminer", ["**VeinMiner**"]],
      ["fallingtree", ["**FallingTree**"]],
    ];
    for (const [slug, lines] of votable) {
      expect(slugs.has(slug)).toBe(true);
      const after = filterGuide(DEFAULT_GUIDE, { mods: new Set([...on, slug]) });
      for (const l of lines) {
        expect([slug, l, before.includes(l)]).toEqual([slug, l, on.has(slug)]);
        expect([slug, l, after.includes(l)]).toEqual([slug, l, true]);
      }
      // and nothing else moved
      const others = votable.filter(([s]) => s !== slug && !on.has(s)).flatMap(([, ls]) => ls);
      for (const l of others) expect([slug, l, after.includes(l)]).toEqual([slug, l, false]);
    }
    const all = filterGuide(DEFAULT_GUIDE, { mods: new Set([...on, ...votable.map(([s]) => s)]) });
    expect(all).toMatch(/1\. Punch a tree[^\n]*\n2\. Craft a backpack[^\n]*\n3\. Find a waystone[^\n]*\n4\. Pick a spot/);
  });
  it("fits in the settings, and reads as Markdown", () => {
    expect(DEFAULT_GUIDE.length).toBeLessThan(20000);
    const blocks = markdown(filterGuide(DEFAULT_GUIDE, { mods: slugs }));
    expect(blocks.filter((b) => b.t === "h").length).toBeGreaterThan(10);
  });
  it("gives the sign-in page its three steps", () => {
    const steps = gettingIn(filterGuide(DEFAULT_GUIDE, mods()));
    expect(steps.split("\n").length).toBe(3);
    expect(steps).toMatch(/^1\. Go to deepslate\.dsw\.test/);
    expect(steps).toContain("press **Play** on the site");
    expect(steps).not.toContain("small room");
  });
});

describe("section and gettingIn", () => {
  it("finds a section by its heading, whatever its case or its tag", () => {
    expect(section("# One\na\n## getting IN <!-- mod: x -->\n1. first\n2. second\n\nafter\n## Next\nb", "Getting in")).toBe("1. first\n2. second\n\nafter");
    expect(section("# One\na", "Getting in")).toBe("");
  });
  it("takes the numbered steps only", () => {
    expect(gettingIn("## Getting in\nBefore.\n\n1. first\n   and more\n2. second\n\nAfter.\n3. not this")).toBe("1. first\n   and more\n2. second");
    expect(gettingIn("## Getting in\nNo steps here.")).toBe("");
    expect(gettingIn("## Something else\n1. x")).toBe("");
  });
});
