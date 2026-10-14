import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// docs/61 (Alex, 2026-10-14): guns are too strong. TaCZ's damage goes to 35% on the server, the stronger guns cost
// steel (tier 2) and netherite and refined obsidian as well (tier 3), ammo crafts give half, and Create Big Cannons'
// projectiles do half the damage to mobs. Each file in deepslate-tools is the jar's own with only those changes.
const MODPACK = path.join(__dirname, "../../../modpack");
const DATA = path.join(MODPACK, "datapacks/deepslate-tools/data");
const GUNS = path.join(DATA, "tacz/recipe/gun");
const AMMO = path.join(DATA, "tacz/recipe/ammo");
const PROJECTILES = path.join(DATA, "createbigcannons/munition_properties/projectiles");

const TIER2 = ["ak47", "aug", "b93r", "cz75", "deagle", "deagle_golden", "fn_fal", "g36k", "hk416d", "hk_g3", "hk_mp5a5", "kar98", "m16a1", "m4a1", "m870", "mk14", "p90", "qbz_191", "qbz_95", "rpk", "scar_l", "sks_tactical", "spr15hb", "taurus500", "timeless50", "type_81", "ump45", "uzi"];
const TIER3 = ["aa12", "ai_awp", "fn_evolys", "m1014", "m107", "m249", "m320", "m95", "minigun", "rpg7", "scar_h", "spas_12", "vector45"];

type Recipe = { materials: Array<{ item: { tag?: string }; count?: number }>; result: { id: string; count?: number } };
const read = async (f: string) => JSON.parse(await readFile(f, "utf8")) as Recipe;
const count = (r: Recipe, tag: string) => r.materials.filter((m) => m.item.tag === tag).reduce((n, m) => n + (m.count ?? 1), 0);
const names = async (dir: string) => (await readdir(dir)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();

describe("gun tiers (docs/61 §4)", () => {
  it("overrides exactly the tier 2 and tier 3 guns; tier 1 keeps the gun pack's recipe", async () => {
    expect(await names(GUNS)).toEqual([...TIER2, ...TIER3].sort());
  });
  it("every overridden gun takes steel for half its iron, rounded up", async () => {
    for (const g of [...TIER2, ...TIER3]) {
      const r = await read(path.join(GUNS, `${g}.json`));
      expect(r.result.id, g).toBe(`tacz:${g}`);
      const iron = count(r, "c:ingots/iron");
      const steel = count(r, "c:ingots/steel");
      expect(steel - iron, g).toBeGreaterThanOrEqual(0);
      expect(steel - iron, g).toBeLessThanOrEqual(1);
      expect(steel, g).toBeGreaterThan(0);
    }
  });
  it("tier 3 also takes 4 refined obsidian and at least 2 netherite; tier 2 neither", async () => {
    for (const g of TIER3) {
      const r = await read(path.join(GUNS, `${g}.json`));
      expect(count(r, "c:ingots/refined_obsidian"), g).toBe(4);
      expect(count(r, "c:ingots/netherite"), g).toBeGreaterThanOrEqual(2);
    }
    for (const g of TIER2) expect(count(await read(path.join(GUNS, `${g}.json`)), "c:ingots/refined_obsidian"), g).toBe(0);
  });
  it("the three big guns keep the gun pack's netherite and add 2", async () => {
    expect(count(await read(path.join(GUNS, "m107.json")), "c:ingots/netherite")).toBe(5);
    expect(count(await read(path.join(GUNS, "m95.json")), "c:ingots/netherite")).toBe(5);
    expect(count(await read(path.join(GUNS, "minigun.json")), "c:ingots/netherite")).toBe(12);
  });
});

describe("ammo (docs/61 §4.3)", () => {
  it("every ammo recipe of the gun pack is overridden, with half the rounds (rounded up)", async () => {
    const files = await names(AMMO);
    expect(files).toHaveLength(24);
    // a few counts read from the jar (TaCZ 1.1.8-hotfix-r7): 9mm 50, 7.62×39 35, 12 gauge 18, rockets 3
    const half: Record<string, number> = { "9mm": 25, "762x39": 18, "12g": 9, rpg_rocket: 2 };
    for (const [f, n] of Object.entries(half)) expect((await read(path.join(AMMO, `${f}.json`))).result.count, f).toBe(n);
  });
});

describe("Create Big Cannons (docs/61 §5)", () => {
  it("every projectile with entity damage is overridden at half the jar's value", async () => {
    expect(await names(PROJECTILES)).toEqual(["ap_autocannon", "ap_shell", "ap_shot", "drop_mortar_shell", "flak_autocannon", "flak_burst", "fluid_shell", "grapeshot_burst", "he_shell", "machine_gun_bullet", "mortar_stone", "shot", "shrapnel_burst", "shrapnel_shell", "smoke_shell", "traffic_cone"]);
    const dmg = async (f: string) => (JSON.parse(await readFile(path.join(PROJECTILES, `${f}.json`), "utf8")) as { entity_damage: number }).entity_damage;
    expect(await dmg("ap_shot")).toBe(25);
    expect(await dmg("machine_gun_bullet")).toBe(4);
    expect(await dmg("grapeshot_burst")).toBe(7.5);
  });
});

describe("TaCZ's server multiplier (docs/61 §3)", () => {
  it("is 0.35 for damage; armour ignore and headshot stay at 1.0", async () => {
    const toml = await readFile(path.join(MODPACK, "server/config/tacz-server.toml"), "utf8");
    expect(toml).toMatch(/^\tDamageBaseMultiplier = 0\.35$/m);
    expect(toml).toMatch(/^\tArmorIgnoreBaseMultiplier = 1\.0$/m);
    expect(toml).toMatch(/^\tHeadShotBaseMultiplier = 1\.0$/m);
  });
});
