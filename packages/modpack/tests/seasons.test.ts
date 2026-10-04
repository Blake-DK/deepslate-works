import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSeasons, lintSeasons, loadSeasons, seasonDatapack, seasonSchema, TRIGGERS_1_21_1, wakeTitle, type Season } from "../src/seasons";

// docs/20 §4, docs/34 §2 and §3 (W1.1): the season files, their lint, and the datapack built from one.

const SEASONS = path.join(__dirname, "../../../modpack/seasons");
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

const ENTITIES = new Set(["minecraft:ravager", "minecraft:iron_golem", "mowziesmobs:frostmaw"]);
const base = (over: Record<string, unknown> = {}): Season =>
  seasonSchema.parse({
    id: "t1", name: "Test Season", startsAt: "2026-11-04T19:00:00Z", endsAt: "2026-12-16T19:00:00Z",
    bosses: [{ id: "frostmaw", title: "Frostmaw", entity: "mowziesmobs:frostmaw", tier: 1, points: 10, trophy: { item: "minecraft:blue_ice", name: "Frostmaw's Tooth" } }],
    trials: [{ id: "bed", title: "Sleep On It", opensAt: "2026-11-06T19:00:00Z", points: 5, criteria: { trigger: "minecraft:slept_in_bed" } }],
    ...over,
  });
const messages = (seasons: Season[]) => lintSeasons(seasons, ENTITIES).map((i) => i.message);

describe("the season files in the repo", () => {
  it("all parse and lint clean: no duplicate title, every entity checked on the server, every date inside its season", async () => {
    const { seasons, index, issues, entities } = await loadSeasons(SEASONS);
    expect(issues).toEqual([]);
    expect(seasons.map((s) => s.id).sort()).toEqual(["s1", "sample"]);
    expect(index.current).toBe("s1");
    expect(entities.has("cataclysm:ignis")).toBe(true);
  });

  it("the real Season 1 is not shipped to the server before its opening day (docs/34 §8, decision 1)", async () => {
    const { index, seasons } = await loadSeasons(SEASONS);
    const s1 = seasons.find((s) => s.id === "s1")!;
    if (Date.now() < Date.parse(s1.startsAt)) expect(index.ship).not.toContain("s1");
  });

  it("Season 1 is docs/32 §2: ten bosses on three tiers, a trial for each of the first five weeks, the Dragon for everybody", async () => {
    const s1 = (await loadSeasons(SEASONS)).seasons.find((s) => s.id === "s1")!;
    expect(s1.startsAt).toBe("2026-11-04T19:00:00Z");
    expect(s1.endsAt).toBe("2026-12-16T19:00:00Z");
    expect(s1.bosses.map((b) => b.tier).sort()).toEqual([1, 1, 1, 2, 2, 2, 2, 2, 2, 3]);
    expect(s1.trials.map((t) => t.opensAt)).toEqual(["2026-11-04T19:00:00Z", "2026-11-13T19:00:00Z", "2026-11-20T19:00:00Z", "2026-11-27T19:00:00Z", "2026-12-04T19:00:00Z"]);
    expect(s1.bosses.find((b) => b.id === "ender_dragon")).toMatchObject({ tier: 3, points: 30, groupRadius: 0 });
    expect(s1.finale).toMatchObject({ at: "2026-12-12T20:00:00Z", boss: "ender_dragon" });
  });
});

describe("lint: each mistake with a line that says which", () => {
  it("a clean season has nothing to say", () => {
    expect(messages([base()])).toEqual([]);
  });
  it("two equal titles, in one season or across two, and a wake line that collides", () => {
    const twice = base({ trials: [{ id: "a", title: "Frostmaw", opensAt: "2026-11-06T19:00:00Z", points: 5, criteria: { trigger: "minecraft:slept_in_bed" } }] });
    expect(messages([twice])[0]).toMatch(/the title "Frostmaw" \(trial a\) is already used by t1 boss frostmaw/);
    const other = { ...base(), id: "t2", name: "Another Season" } as Season;
    expect(messages([base(), other]).some((m) => /"Frostmaw" \(boss frostmaw\) is already used by t1 boss frostmaw/.test(m))).toBe(true);
    const wake = base({ trials: [{ id: "a", title: "Woke Frostmaw", opensAt: "2026-11-06T19:00:00Z", points: 5, criteria: { trigger: "minecraft:slept_in_bed" } }] });
    expect(messages([wake])[0]).toMatch(/"Woke Frostmaw"/);
    expect(wakeTitle({ title: "Frostmaw" })).toBe("Woke Frostmaw");
  });
  it("an entity nobody has checked on the server", () => {
    const s = base({ bosses: [{ id: "x", title: "Mystery", entity: "cataclysm:nameless_sorcerer", tier: 1, points: 1, trophy: { item: "minecraft:stone", name: "A Stone" } }] });
    expect(messages([s])[0]).toMatch(/boss x: the entity cataclysm:nameless_sorcerer is not in modpack\/seasons\/entities\.json/);
  });
  it("a date outside the season, an end before the start, a finale for a boss that is not on the ladder", () => {
    expect(messages([base({ trials: [{ id: "late", title: "Too Late", opensAt: "2027-01-01T19:00:00Z", points: 5, criteria: { trigger: "minecraft:slept_in_bed" } }] })])[0]).toMatch(/trial late: opensAt 2027-01-01T19:00:00Z is outside the season/);
    expect(messages([base({ endsAt: "2026-11-01T19:00:00Z", trials: [] })])[0]).toMatch(/is not after startsAt/);
    expect(messages([base({ finale: { at: "2026-12-12T20:00:00Z", title: "x", boss: "nobody" } })])[0]).toMatch(/the finale names the boss nobody/);
  });
  it("a trigger the game does not have, and a mod's own trigger", () => {
    expect(messages([base({ trials: [{ id: "a", title: "A", opensAt: "2026-11-06T19:00:00Z", points: 5, criteria: { trigger: "minecraft:rode_a_train" } }] })])[0]).toMatch(/minecraft:rode_a_train .* is not an advancement trigger of Minecraft 1\.21\.1/);
    expect(messages([base({ trials: [{ id: "a", title: "A", opensAt: "2026-11-06T19:00:00Z", points: 5, criteria: { trigger: "create:train_ridden" } }] })])[0]).toMatch(/a mod's own/);
    expect(TRIGGERS_1_21_1.has("player_killed_entity") && TRIGGERS_1_21_1.has("player_hurt_entity")).toBe(true);
  });
  it("the schema refuses a time without Z, a title with brackets, an id with capitals", () => {
    const raw = { id: "t1", name: "Test Season", startsAt: "2026-11-04T19:00:00Z", endsAt: "2026-12-16T19:00:00Z", bosses: [], trials: [] };
    expect(seasonSchema.safeParse({ ...raw, startsAt: "2026-11-04T19:00:00" }).success).toBe(false);
    expect(seasonSchema.safeParse({ ...raw, name: "Season [One]" }).success).toBe(false);
    expect(seasonSchema.safeParse({ ...raw, id: "S1" }).success).toBe(false);
    expect(seasonSchema.safeParse(raw).success).toBe(true);
  });
});

describe("the datapack of a season", () => {
  const pack = seasonDatapack(base());
  const get = (p: string) => JSON.parse(pack.get(p)!) as Record<string, never>;

  it("has exactly these files", () => {
    expect([...pack.keys()].sort()).toEqual([
      "data/deepslate/advancement/t1/boss/frostmaw.json",
      "data/deepslate/advancement/t1/root.json",
      "data/deepslate/advancement/t1/trial/bed.json",
      "data/deepslate/advancement/t1/wake/frostmaw.json",
      "data/deepslate/function/t1/boss/frostmaw.mcfunction",
      "data/deepslate/function/t1/load.mcfunction",
      "data/deepslate/function/t1/share/frostmaw.mcfunction",
      "data/deepslate/function/t1/tick.mcfunction",
      "data/deepslate/function/t1/unwake.mcfunction",
      "data/deepslate/function/t1/wake/frostmaw.mcfunction",
      "data/deepslate/loot_table/t1/trophy/frostmaw.json",
      "data/minecraft/tags/function/load.json",
      "data/minecraft/tags/function/tick.json",
      "pack.mcmeta",
    ]);
  });

  it("is a 1.21.1 datapack, and every JSON file parses", () => {
    expect(get("pack.mcmeta")).toEqual({ pack: { pack_format: 48, description: "Deepslate Works: Test Season" } });
    for (const [p, body] of pack) if (p.endsWith(".json") || p === "pack.mcmeta") expect(() => JSON.parse(body)).not.toThrow();
  });

  it("a boss: a challenge that is announced, won by killing that entity, with its reward function", () => {
    expect(get("data/deepslate/advancement/t1/boss/frostmaw.json")).toMatchObject({
      parent: "deepslate:t1/root",
      display: { title: { text: "Frostmaw" }, frame: "challenge", announce_to_chat: true, show_toast: true, hidden: false },
      criteria: { kill: { trigger: "minecraft:player_killed_entity", conditions: { entity: { type: "mowziesmobs:frostmaw" } } } },
      rewards: { function: "deepslate:t1/boss/frostmaw" },
    });
  });

  it("group credit: the killer's run shares the tick within 48 blocks; nobody gets a second trophy; the wake is taken back", () => {
    expect(pack.get("data/deepslate/function/t1/boss/frostmaw.mcfunction")!.split("\n").filter((l) => l && !l.startsWith("#"))).toEqual([
      "execute unless entity @s[tag=dw.credit] run function deepslate:t1/share/frostmaw",
      "loot give @s[tag=!dw.t1.t.frostmaw] loot deepslate:t1/trophy/frostmaw",
      "tag @s add dw.t1.t.frostmaw",
      "advancement revoke @s only deepslate:t1/wake/frostmaw",
    ]);
    expect(pack.get("data/deepslate/function/t1/share/frostmaw.mcfunction")!.split("\n").filter((l) => l && !l.startsWith("#"))).toEqual([
      "tag @a[distance=..48] add dw.credit",
      "advancement grant @a[distance=..48,tag=dw.credit] only deepslate:t1/boss/frostmaw",
      "tag @a[tag=dw.credit] remove dw.credit",
    ]);
  });

  it("groupRadius 0 (the Dragon): everybody in the killer's dimension", () => {
    const all = seasonDatapack(base({ groupRadius: 0 }));
    expect(all.get("data/deepslate/function/t1/share/frostmaw.mcfunction")).toContain("advancement grant @a[distance=0..,tag=dw.credit] only deepslate:t1/boss/frostmaw");
  });

  it("'has awoken': a hidden advancement on the first hit, announced, with no toast; held for 15 minutes", () => {
    expect(get("data/deepslate/advancement/t1/wake/frostmaw.json")).toMatchObject({
      display: { title: { text: "Woke Frostmaw" }, announce_to_chat: true, show_toast: false, hidden: true },
      criteria: { hit: { trigger: "minecraft:player_hurt_entity", conditions: { entity: { type: "mowziesmobs:frostmaw" } } } },
    });
    expect(pack.get("data/deepslate/function/t1/tick.mcfunction")).toBe("scoreboard players add @a[tag=dw.t1.woke] dw_t1_wake 1\nexecute as @a[tag=dw.t1.woke,scores={dw_t1_wake=18000..}] run function deepslate:t1/unwake\n");
    expect(pack.get("data/deepslate/function/t1/unwake.mcfunction")).toContain("advancement revoke @s only deepslate:t1/wake/frostmaw");
    expect(get("data/minecraft/tags/function/tick.json")).toEqual({ values: ["deepslate:t1/tick"] });
  });

  it("the tick function only ever selects players who woke a boss, never every entity", () => {
    for (const [p, body] of pack) if (p.endsWith(".mcfunction")) expect([p, /@e\b/.test(body)]).toEqual([p, false]);
    for (const line of pack.get("data/deepslate/function/t1/tick.mcfunction")!.split("\n").filter(Boolean)) expect(line).toContain("tag=dw.t1.woke");
  });

  it("a trophy: one named item with lore and a glint, no stats", () => {
    const entry = (get("data/deepslate/loot_table/t1/trophy/frostmaw.json") as unknown as { pools: Array<{ rolls: number; entries: Array<{ name: string; functions: Array<Record<string, unknown>> }> }> }).pools[0]!;
    expect(entry.rolls).toBe(1);
    expect(entry.entries[0]!.name).toBe("minecraft:blue_ice");
    expect(entry.entries[0]!.functions.map((f) => f.function)).toEqual(["minecraft:set_name", "minecraft:set_lore", "minecraft:set_components"]);
    expect(JSON.stringify(entry)).toContain("Test Season · Frostmaw");
    expect(JSON.stringify(entry)).not.toMatch(/attribute|enchantments"/);
  });

  it("a trial: its criteria as written, hidden until done; several criteria by name are kept", () => {
    expect(get("data/deepslate/advancement/t1/trial/bed.json")).toMatchObject({ display: { title: { text: "Sleep On It" }, hidden: true, announce_to_chat: true }, criteria: { done: { trigger: "minecraft:slept_in_bed" } } });
    const two = seasonDatapack(base({ trials: [{ id: "two", title: "Two Things", opensAt: "2026-11-06T19:00:00Z", points: 5, criteria: { bed: { trigger: "minecraft:slept_in_bed" }, eye: { trigger: "minecraft:used_ender_eye" } } }] }));
    expect(Object.keys((JSON.parse(two.get("data/deepslate/advancement/t1/trial/two.json")!) as { criteria: object }).criteria)).toEqual(["bed", "eye"]);
  });

  it("every function line is a command we mean to send", () => {
    for (const [p, body] of pack) if (p.endsWith(".mcfunction")) for (const line of body.split("\n").filter((l) => l && !l.startsWith("#"))) expect([p, /^(execute|loot|tag|advancement|scoreboard) /.test(line)]).toEqual([p, true]);
  });
});

describe("build seasons", () => {
  async function repo(ship: string[]) {
    const d = await mkdtemp(path.join(tmpdir(), "seasons-"));
    dirs.push(d);
    await mkdir(path.join(d, "seasons"));
    for (const f of ["sample.json", "s1.json", "entities.json"]) await writeFile(path.join(d, "seasons", f), await readFile(path.join(SEASONS, f)));
    await writeFile(path.join(d, "seasons", "index.json"), JSON.stringify({ current: "s1", ship }));
    return { seasons: path.join(d, "seasons"), dist: path.join(d, "dist") };
  }

  it("builds only what `ship` names, and takes a season out of dist when it leaves `ship`", async () => {
    const p = await repo(["sample"]);
    expect(await buildSeasons(p, () => undefined)).toEqual(["sample"]);
    const out = path.join(p.dist, "server", "datapacks");
    expect(await readdir(out)).toEqual(["deepslate-season-sample"]);
    expect(JSON.parse(await readFile(path.join(out, "deepslate-season-sample", "pack.mcmeta"), "utf8"))).toMatchObject({ pack: { pack_format: 48 } });
    await mkdir(path.join(out, "deepslate-tools")); // another datapack of the pack is never touched
    await writeFile(path.join(p.seasons, "index.json"), JSON.stringify({ current: "s1", ship: [] }));
    expect(await buildSeasons(p, () => undefined)).toEqual([]);
    expect(await readdir(out)).toEqual(["deepslate-tools"]);
  });

  it("a season file with an error stops the build and says which", async () => {
    const p = await repo(["sample"]);
    const bad = JSON.parse(await readFile(path.join(p.seasons, "sample.json"), "utf8")) as { trials: Array<{ title: string }>; bosses: Array<{ title: string }> };
    bad.trials[0]!.title = bad.bosses[0]!.title;
    await writeFile(path.join(p.seasons, "sample.json"), JSON.stringify(bad));
    await expect(buildSeasons(p, () => undefined)).rejects.toThrow(/sample: the title "The Rehearsal Ravager"/);
  });

  it("`ship` naming a season that does not exist is an error", async () => {
    const p = await repo(["s9"]);
    await expect(buildSeasons(p, () => undefined)).rejects.toThrow(/ship names s9/);
  });
});
