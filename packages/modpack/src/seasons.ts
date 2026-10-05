import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

// docs/20 §4 and docs/34 §2, §3: one file per season in modpack/seasons/, and a build step that turns it into a
// datapack (deepslate-season-<id>): an advancement per boss and per trial, a hidden "woke" advancement per boss,
// group credit, trophies. Data only: no PC updates, and it is not part of the pack hash.
//
// The server's console line for an advancement carries only its title, so titles are unique across every season
// in the repo, and the build fails on a duplicate. That is how the portal knows which boss or trial it was.

const ID = /^[a-z0-9_]{1,32}$/;
const RESOURCE = /^[a-z0-9_.-]{1,64}:[a-z0-9_./-]{1,64}$/;
/** A title goes into the console line between square brackets and into a JSON text: plain words. */
const TITLE = /^[^\[\]"\\\n\r]{2,60}$/;
const when = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "a UTC time like 2026-11-04T19:00:00Z");

const criterion = z.object({ trigger: z.string().regex(RESOURCE), conditions: z.record(z.unknown()).default({}) });

const boss = z.object({
  id: z.string().regex(ID),
  title: z.string().regex(TITLE),
  entity: z.string().regex(RESOURCE),
  tier: z.number().int().min(1).max(3),
  points: z.number().int().min(0).max(1000),
  /** When it joins the ladder. Killed before that it counts, and shows as "found early". Default: the season's start. */
  opensAt: when.optional(),
  where: z.string().max(120).default(""),
  hint: z.string().max(240).default(""),
  /** A vanilla item with a name of its own, lore and a glint; no stats. */
  trophy: z.object({ item: z.string().regex(RESOURCE), name: z.string().regex(TITLE) }),
  /** Who gets the tick with the killer: within this many blocks; 0 = everyone in the killer's dimension. Default: the season's. */
  groupRadius: z.number().int().min(0).max(512).optional(),
});

const trial = z.object({
  id: z.string().regex(ID),
  title: z.string().regex(TITLE),
  opensAt: when,
  points: z.number().int().min(0).max(1000),
  solo: z.boolean().default(true),
  hint: z.string().max(240).default(""),
  icon: z.string().regex(RESOURCE).default("minecraft:paper"),
  /** One criterion, or several by name (all of them needed), passed through to the advancement as written. */
  criteria: z.union([criterion, z.record(criterion)]),
});

export const seasonSchema = z.object({
  id: z.string().regex(ID),
  name: z.string().regex(TITLE),
  startsAt: when,
  endsAt: when,
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().regex(RESOURCE).default("minecraft:netherite_sword"),
  groupRadius: z.number().int().min(0).max(512).default(48),
  bosses: z.array(boss).max(40),
  trials: z.array(trial).max(40),
  goal: z.object({ title: z.string().max(80), count: z.literal("boss_kills"), target: z.number().int().min(1) }).optional(),
  finale: z.object({ at: when, title: z.string().max(80), boss: z.string().regex(ID) }).optional(),
  /** docs/20 §5: the season's own dimension, wiped at its end. `noise`: the noise settings its terrain is made with. */
  frontier: z.object({
    dimension: z.string().regex(/^deepslate:[a-z0-9_]{1,40}$/), noise: z.string().regex(RESOURCE), radius: z.number().int().min(500).max(10_000),
    /**
     * docs/34 §10: the way in is a real portal (the mod Server Sided Portals, on the server only). `frame`: the block
     * a portal's frame is built of. `igniter`: the one item that lights it. Both default to things nobody can get in
     * survival, so only an admin makes a portal; the one the mod builds on the far side uses the same frame.
     */
    portal: z.object({ frame: z.string().regex(RESOURCE).default("minecraft:reinforced_deepslate"), igniter: z.string().regex(RESOURCE).default("minecraft:knowledge_book") }).default({}),
  }).optional(),
});
export type Season = z.infer<typeof seasonSchema>;

/**
 * Noise settings a Frontier may use. A dimension file cannot carry a seed of its own in 1.21.1, so with
 * minecraft:overworld the Frontier would be a copy of the main world, and minecraft:amplified is too heavy for the
 * weak PCs (docs/20 §5). Settings of our own (a later season) are added here when their file is in the datapack.
 */
export const FRONTIER_NOISE = new Set(["minecraft:large_biomes"]);
/** What lights a nether portal: never the Frontier's igniter. */
const PORTAL_FIRE = new Set(["minecraft:flint_and_steel", "minecraft:fire_charge"]);
export type SeasonBoss = Season["bosses"][number];
export type SeasonTrial = Season["trials"][number];

/** modpack/seasons/index.json. `ship`: the seasons whose datapack goes to the server at the next Build and Sync. */
export const seasonIndexSchema = z.object({
  current: z.string().regex(ID).nullable(),
  ship: z.array(z.string().regex(ID)).default([]),
  /**
   * Seasons whose Frontier alone goes to the server: the dimension and its portal, without the season's
   * advancements. For making the ground ahead of the opening (pre-generation, the temple), and for trying a portal.
   */
  frontiers: z.array(z.string().regex(ID)).default([]),
});
export type SeasonIndex = z.infer<typeof seasonIndexSchema>;

export const wakeTitle = (b: Pick<SeasonBoss, "title">) => `Woke ${b.title}`;

/** Every advancement trigger of Minecraft 1.21.1 (the game's own registry), without the namespace. */
export const TRIGGERS_1_21_1 = new Set([
  "allay_drop_item_on_block", "any_block_use", "avoid_vibration", "bee_nest_destroyed", "bred_animals", "brewed_potion", "changed_dimension",
  "channeled_lightning", "construct_beacon", "consume_item", "crafter_recipe_crafted", "cured_zombie_villager", "default_block_use", "effects_changed",
  "enchanted_item", "enter_block", "entity_hurt_player", "entity_killed_player", "fall_after_explosion", "fall_from_height", "filled_bucket",
  "fishing_rod_hooked", "hero_of_the_village", "impossible", "inventory_changed", "item_durability_changed", "item_used_on_block",
  "kill_mob_near_sculk_catalyst", "killed_by_crossbow", "levitation", "lightning_strike", "location", "nether_travel", "placed_block",
  "player_generates_container_loot", "player_hurt_entity", "player_interacted_with_entity", "player_killed_entity", "recipe_crafted", "recipe_unlocked",
  "ride_entity_in_lava", "shot_crossbow", "slept_in_bed", "slide_down_block", "started_riding", "summoned_entity", "tame_animal", "target_hit",
  "thrown_item_picked_up_by_entity", "thrown_item_picked_up_by_player", "tick", "used_ender_eye", "used_totem", "using_item", "villager_trade", "voluntary_exile",
]);

export type SeasonIssue = { season: string; message: string };

/**
 * Is this moment on the last Monday of its month, by the UK's calendar? (An evening hour in UTC is the same day in
 * the UK, summer and winter; the UK day is asked for all the same.)
 */
export function isLastMondayOfItsMonth(iso: string): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "numeric", year: "numeric" }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  if (get("weekday") !== "Mon") return false;
  const daysInMonth = new Date(Date.UTC(Number(get("year")), Number(get("month")), 0)).getUTCDate();
  return Number(get("day")) + 7 > daysInMonth;
}

/** The last Monday of a month (1 to 12), as a day of the month. */
export function lastMonday(year: number, month: number): number {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let d = days; d > days - 7; d--) if (new Date(Date.UTC(year, month - 1, d)).getUTCDay() === 1) return d;
  return days;
}

const criteriaOf = (t: SeasonTrial): Record<string, z.infer<typeof criterion>> => ("trigger" in t.criteria && typeof t.criteria.trigger === "string" ? { done: t.criteria as z.infer<typeof criterion> } : (t.criteria as Record<string, z.infer<typeof criterion>>));

/**
 * What a schema cannot say. `entities`: the ids that have been checked on the running server (docs/11, 2026-10-02;
 * modpack/seasons/entities.json). An id that is not in it is an error until somebody has checked it there.
 * `vanillaItems`: the game's own items without the namespace (modpack/items/vanilla-1.21.1.json). With it, a
 * minecraft: item the game does not have is an error (a trophy of it cannot be given, an icon of it breaks the
 * advancement); a mod's item is let through, since the full catalogue exists only after a build. Without it, item
 * ids are not checked.
 */
export function lintSeasons(seasons: Season[], entities: ReadonlySet<string>, vanillaItems?: ReadonlySet<string>): SeasonIssue[] {
  const issues: SeasonIssue[] = [];
  const titles = new Map<string, string>(); // title (lower case) → where it was first used
  const frontiers = new Map<string, string>(); // dimension → the season it belongs to
  const seen = new Set<string>();
  for (const s of seasons) {
    const err = (message: string) => issues.push({ season: s.id, message });
    if (seen.has(s.id)) err(`two seasons have the id ${s.id}`);
    seen.add(s.id);
    const start = Date.parse(s.startsAt);
    const end = Date.parse(s.endsAt);
    if (!(end > start)) err(`endsAt (${s.endsAt}) is not after startsAt (${s.startsAt})`);
    // Alex, 2026-10-04: a season opens on the last Monday of a month and ends on the last Monday of the next.
    // Checked for the numbered seasons (s1, s2, …); the sample and any test season keep their own dates.
    if (/^s\d+$/.test(s.id)) {
      if (!isLastMondayOfItsMonth(s.startsAt)) err(`startsAt ${s.startsAt} is not the last Monday of its month (UK time)`);
      if (!isLastMondayOfItsMonth(s.endsAt)) err(`endsAt ${s.endsAt} is not the last Monday of its month (UK time)`);
      const months = (new Date(end).getUTCFullYear() - new Date(start).getUTCFullYear()) * 12 + new Date(end).getUTCMonth() - new Date(start).getUTCMonth();
      if (months !== 1) err(`a season runs from the last Monday of one month to the last Monday of the next; this one spans ${months} month(s)`);
    }
    const inside = (t: string) => Date.parse(t) >= start && Date.parse(t) <= end;
    const title = (text: string, what: string) => {
      const key = text.toLowerCase();
      const first = titles.get(key);
      if (first) err(`the title "${text}" (${what}) is already used by ${first}: titles are unique across all seasons, the console line carries nothing else`);
      else titles.set(key, `${s.id} ${what}`);
    };
    title(s.name, "the season's name");
    const item = (id: string, what: string) => {
      const [ns, key] = id.split(":");
      if (vanillaItems && ns === "minecraft" && !vanillaItems.has(key ?? "")) err(`${what}: ${id} is not an item of Minecraft 1.21.1 (modpack/items/vanilla-1.21.1.json)`);
    };
    item(s.icon, "the season's icon");
    const ids = new Set<string>();
    const bossOf = new Map<string, string>(); // entity → the boss that has it
    for (const b of s.bosses) {
      if (ids.has(`boss:${b.id}`)) err(`two bosses have the id ${b.id}`);
      ids.add(`boss:${b.id}`);
      title(b.title, `boss ${b.id}`);
      title(wakeTitle(b), `the wake line of boss ${b.id}`);
      title(b.trophy.name, `the trophy of boss ${b.id}`);
      if (!entities.has(b.entity)) err(`boss ${b.id}: the entity ${b.entity} is not in modpack/seasons/entities.json (ids checked on the running server); check it there and add it`);
      // one kill would tick both, and the console line of one hides the other
      const sameEntity = bossOf.get(b.entity);
      if (sameEntity !== undefined) err(`boss ${b.id}: the entity ${b.entity} is boss ${sameEntity}'s already; one entity, one boss in a season`);
      else bossOf.set(b.entity, b.id);
      item(b.trophy.item, `the trophy of boss ${b.id}`);
      if (b.opensAt && !inside(b.opensAt)) err(`boss ${b.id}: opensAt ${b.opensAt} is outside the season`);
    }
    for (const t of s.trials) {
      if (ids.has(`trial:${t.id}`)) err(`two trials have the id ${t.id}`);
      ids.add(`trial:${t.id}`);
      title(t.title, `trial ${t.id}`);
      if (!inside(t.opensAt)) err(`trial ${t.id}: opensAt ${t.opensAt} is outside the season`);
      item(t.icon, `the icon of trial ${t.id}`);
      for (const [name, c] of Object.entries(criteriaOf(t))) {
        const [ns, key] = c.trigger.split(":");
        if (ns === "minecraft" && !TRIGGERS_1_21_1.has(key ?? "")) err(`trial ${t.id}: ${c.trigger} (criterion ${name}) is not an advancement trigger of Minecraft 1.21.1`);
        if (ns !== "minecraft") err(`trial ${t.id}: the trigger ${c.trigger} is a mod's own; only minecraft: triggers are taken until one has been tried on the server`);
        if (!/^[a-z0-9_]{1,32}$/.test(name)) err(`trial ${t.id}: the criterion name "${name}" must be lower case letters, digits and _`);
      }
    }
    if (s.finale) {
      if (!s.bosses.some((b) => b.id === s.finale!.boss)) err(`the finale names the boss ${s.finale.boss}, which is not on the ladder`);
      if (!inside(s.finale.at)) err(`the finale (${s.finale.at}) is outside the season`);
    }
    if (s.frontier) {
      const f = s.frontier;
      if (f.dimension === "deepslate:limbo") err("the Frontier cannot be the entrance room's dimension");
      const other = frontiers.get(f.dimension);
      if (other) err(`the Frontier ${f.dimension} is season ${other}'s already: each season has a dimension of its own, or the wipe would take another season's ground`);
      else frontiers.set(f.dimension, s.id);
      if (f.noise === "minecraft:overworld") err("the Frontier's noise is minecraft:overworld: that would be a copy of the main world (a dimension has no seed of its own in 1.21.1)");
      else if (!FRONTIER_NOISE.has(f.noise)) err(`the Frontier's noise ${f.noise} is not one of ${[...FRONTIER_NOISE].join(", ")}`);
      if (f.portal.frame === "minecraft:obsidian") err("the Frontier's portal frame is obsidian: every nether portal frame would also be a way into the Frontier");
      if (PORTAL_FIRE.has(f.portal.igniter)) err(`the Frontier's portal igniter is ${f.portal.igniter}: anybody could light a portal anywhere; name an item players cannot get`);
    }
  }
  return issues;
}

/**
 * Reads every season file of a folder (all *.json but index.json and entities.json), the index and the entity list.
 * `vanillaFile`: modpack/items/vanilla-1.21.1.json; when given, item ids are checked against it, and a file that
 * cannot be read is an error of its own.
 */
export async function loadSeasons(dir: string, vanillaFile?: string): Promise<{ seasons: Season[]; index: SeasonIndex; entities: Set<string>; issues: SeasonIssue[] }> {
  const issues: SeasonIssue[] = [];
  const seasons: Season[] = [];
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return { seasons, index: { current: null, ship: [], frontiers: [] }, entities: new Set(), issues };
  }
  const read = async (name: string) => JSON.parse(await readFile(path.join(dir, name), "utf8")) as unknown;
  let index: SeasonIndex = { current: null, ship: [], frontiers: [] };
  let entities = new Set<string>();
  for (const name of names) {
    const id = name.replace(/\.json$/, "");
    try {
      if (name === "index.json") index = seasonIndexSchema.parse(await read(name));
      else if (name === "entities.json") entities = new Set(z.array(z.string().regex(RESOURCE)).parse(await read(name)));
      else {
        const parsed = seasonSchema.safeParse(await read(name));
        if (!parsed.success) for (const i of parsed.error.issues) issues.push({ season: id, message: `${i.path.join(".") || "(file)"}: ${i.message}` });
        else if (parsed.data.id !== id) issues.push({ season: id, message: `the file is ${name} but its id is ${parsed.data.id}` });
        else seasons.push(parsed.data);
      }
    } catch (e) {
      issues.push({ season: id, message: `${name} cannot be read: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  let vanillaItems: Set<string> | undefined;
  if (vanillaFile !== undefined) {
    try {
      vanillaItems = new Set(Object.keys(z.object({ items: z.record(z.unknown()) }).parse(JSON.parse(await readFile(vanillaFile, "utf8"))).items));
    } catch (e) {
      issues.push({ season: "items", message: `${vanillaFile} cannot be read, so no item id was checked: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  issues.push(...lintSeasons(seasons, entities, vanillaItems));
  const known = new Set(seasons.map((s) => s.id));
  if (index.current && !known.has(index.current)) issues.push({ season: "index", message: `current is ${index.current}, and there is no such season file` });
  for (const id of index.ship) if (!known.has(id)) issues.push({ season: "index", message: `ship names ${id}, and there is no such season file` });
  for (const id of index.frontiers) {
    const s = seasons.find((x) => x.id === id);
    if (!s) issues.push({ season: "index", message: `frontiers names ${id}, and there is no such season file` });
    else if (!s.frontier) issues.push({ season: "index", message: `frontiers names ${id}, and that season has no frontier` });
  }
  return { seasons, index, entities, issues };
}

// ---- the datapack ----------------------------------------------------------------------------------------------

export const PACK_FORMAT_1_21_1 = 48;
/** 15 minutes in ticks: how long a "woke" advancement is held before it is taken back, so the line can come again another evening (docs/21 §6). */
export const WAKE_TICKS = 18_000;

const text = (t: string, extra: Record<string, unknown> = {}) => ({ text: t, ...extra });
/** Who shares a kill: within the radius of the killer, or with 0 everyone in the killer's dimension. */
const group = (radius: number, more = "") => (radius > 0 ? `@a[distance=..${radius}${more}]` : `@a[distance=0..${more}]`);

/**
 * Every file of a season's datapack, by its path inside the pack. Pure, so it is tested as a tree.
 *
 * Group credit (docs/20 decision 7): the kill's reward function grants the same advancement to everybody near the
 * killer. A granted advancement runs its reward function too, so each of them comes through the same function:
 * the tag dw.credit keeps them from sharing it on again, and the tag dw.<season>.t.<boss> keeps the trophy to one
 * per player per boss, whatever calls the function and however often the boss is killed.
 */
export function seasonDatapack(s: Season): Map<string, string> {
  const files = new Map<string, string>();
  const json = (p: string, v: unknown) => files.set(p, `${JSON.stringify(v, null, 2)}\n`);
  const fn = (p: string, lines: string[]) => files.set(p, `${lines.join("\n")}\n`);
  const ns = "deepslate";
  const adv = (rest: string) => `data/${ns}/advancement/${s.id}/${rest}.json`;
  const ref = (rest: string) => `${ns}:${s.id}/${rest}`;
  const objective = `dw_${s.id}_wake`.slice(0, 16); // an objective's name: 16 characters at most on the safe side
  const woke = `dw.${s.id}.woke`;

  json("pack.mcmeta", { pack: { pack_format: PACK_FORMAT_1_21_1, description: `Deepslate Works: ${s.name}` } });

  // the season's own tab on the advancements screen; everybody has it from their first tick
  json(adv("root"), {
    display: {
      icon: { id: s.icon },
      title: text(s.name),
      description: text("Bosses and trials of this season. A kill counts for everyone who was there."),
      background: "minecraft:textures/gui/advancements/backgrounds/stone.png",
      frame: "task", show_toast: false, announce_to_chat: false, hidden: false,
    },
    criteria: { here: { trigger: "minecraft:tick" } },
  });

  for (const b of s.bosses) {
    const radius = b.groupRadius ?? s.groupRadius;
    const got = `dw.${s.id}.t.${b.id}`;
    json(adv(`boss/${b.id}`), {
      parent: ref("root"),
      display: {
        icon: { id: b.trophy.item },
        title: text(b.title),
        description: text([b.where, b.hint].filter(Boolean).join(". ") || "A boss of this season."),
        frame: "challenge", show_toast: true, announce_to_chat: true, hidden: false,
      },
      criteria: { kill: { trigger: "minecraft:player_killed_entity", conditions: { entity: { type: b.entity } } } },
      rewards: { function: ref(`boss/${b.id}`) },
    });
    fn(`data/${ns}/function/${s.id}/boss/${b.id}.mcfunction`, [
      `# ${b.title}: run for the killer by the advancement, and for everyone the kill is shared with by the grant below.`,
      `execute unless entity @s[tag=dw.credit] run function ${ref(`share/${b.id}`)}`,
      `loot give @s[tag=!${got}] loot ${ref(`trophy/${b.id}`)}`,
      `tag @s add ${got}`,
      `advancement revoke @s only ${ref(`wake/${b.id}`)}`,
    ]);
    fn(`data/${ns}/function/${s.id}/share/${b.id}.mcfunction`, [
      `# The killer's run only: ${radius > 0 ? `everybody within ${radius} blocks` : "everybody in this dimension"} gets the same tick.`,
      `tag ${group(radius)} add dw.credit`,
      `advancement grant ${group(radius, ",tag=dw.credit")} only ${ref(`boss/${b.id}`)}`,
      `tag @a[tag=dw.credit] remove dw.credit`,
    ]);
    // "has awoken" (docs/21 §6): the game has no line for a fight beginning, so the first hit makes one
    json(adv(`wake/${b.id}`), {
      parent: ref("root"),
      display: {
        icon: { id: b.trophy.item },
        title: text(wakeTitle(b)),
        description: text(`The fight with ${b.title} has begun.`),
        frame: "task", show_toast: false, announce_to_chat: true, hidden: true,
      },
      criteria: { hit: { trigger: "minecraft:player_hurt_entity", conditions: { entity: { type: b.entity } } } },
      rewards: { function: ref(`wake/${b.id}`) },
    });
    fn(`data/${ns}/function/${s.id}/wake/${b.id}.mcfunction`, [`tag @s add ${woke}`, `scoreboard players set @s ${objective} 0`]);
    json(`data/${ns}/loot_table/${s.id}/trophy/${b.id}.json`, {
      pools: [{
        rolls: 1,
        entries: [{
          type: "minecraft:item", name: b.trophy.item,
          functions: [
            { function: "minecraft:set_name", target: "custom_name", name: text(b.trophy.name, { color: "gold", italic: false }) },
            { function: "minecraft:set_lore", mode: "replace_all", lore: [text(`${s.name} · ${b.title}`, { color: "gray", italic: false })] },
            { function: "minecraft:set_components", components: { "minecraft:enchantment_glint_override": true } },
          ],
        }],
      }],
    });
  }

  for (const t of s.trials) {
    json(adv(`trial/${t.id}`), {
      parent: ref("root"),
      display: {
        icon: { id: t.icon },
        title: text(t.title),
        description: text(t.hint || "A trial of this season."),
        // hidden until it is done: one finished before its week counts, and the site calls it "found early"
        frame: "task", show_toast: true, announce_to_chat: true, hidden: true,
      },
      criteria: criteriaOf(t),
    });
  }

  // Whoever woke a boss holds the tag; only they are counted, so the cost does not grow with who is online.
  fn(`data/${ns}/function/${s.id}/load.mcfunction`, [`scoreboard objectives add ${objective} dummy`]);
  fn(`data/${ns}/function/${s.id}/tick.mcfunction`, [
    `scoreboard players add @a[tag=${woke}] ${objective} 1`,
    `execute as @a[tag=${woke},scores={${objective}=${WAKE_TICKS}..}] run function ${ref("unwake")}`,
  ]);
  fn(`data/${ns}/function/${s.id}/unwake.mcfunction`, [
    ...s.bosses.map((b) => `advancement revoke @s only ${ref(`wake/${b.id}`)}`),
    `tag @s remove ${woke}`,
    `scoreboard players reset @s ${objective}`,
  ]);
  json("data/minecraft/tags/function/load.json", { values: [ref("load")] });
  json("data/minecraft/tags/function/tick.json", { values: [ref("tick")] });
  return files;
}

export const seasonPackName = (id: string) => `deepslate-season-${id}`;
export const frontierPackName = (id: string) => `deepslate-frontier-${id}`;

/**
 * docs/20 §5: the Frontier's datapack, one dimension: an overworld (the vanilla dimension type and biomes) on the
 * season's noise settings, and the tags that make a portal to it (docs/34 §10). A datapack of its own, so that the wipe takes it off without touching the season's
 * advancements. A new dimension counts from the server's next start, not from a reload.
 */
export function frontierDatapack(s: Season): Map<string, string> | null {
  if (!s.frontier) return null;
  const files = new Map<string, string>();
  const json = (p: string, v: unknown) => files.set(p, `${JSON.stringify(v, null, 2)}\n`);
  const name = s.frontier.dimension.split(":")[1]!;
  json("pack.mcmeta", { pack: { pack_format: PACK_FORMAT_1_21_1, description: `Deepslate Works: the Frontier of ${s.name}` } });
  json(`data/deepslate/dimension/${name}.json`, {
    type: "minecraft:overworld",
    generator: { type: "minecraft:noise", settings: s.frontier.noise, biome_source: { type: "minecraft:multi_noise", preset: "minecraft:overworld" } },
  });
  // Server Sided Portals reads two tags in the dimension's namespace, named after the dimension. With an igniter
  // tag that is not empty, fire no longer lights the frame. The main world is the connection by default.
  json(`data/deepslate/tags/block/${name}_portal_frame.json`, { values: [s.frontier.portal.frame] });
  json(`data/deepslate/tags/item/${name}_portal_igniter.json`, { values: [s.frontier.portal.igniter] });
  return files;
}

async function writePack(root: string, files: Map<string, string>): Promise<void> {
  await rm(root, { recursive: true, force: true });
  for (const [rel, body] of files) {
    const file = path.join(root, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }
}

/** Writes one season's datapack under `outDir/deepslate-season-<id>/`, made afresh. */
export async function writeSeasonDatapack(s: Season, outDir: string): Promise<string> {
  const root = path.join(outDir, seasonPackName(s.id));
  await rm(root, { recursive: true, force: true });
  for (const [rel, body] of seasonDatapack(s)) {
    const file = path.join(root, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }
  return root;
}

/**
 * `build seasons`, and the last step of `build server`: the datapacks of the seasons index.json's `ship` names go
 * into dist/server/datapacks/, which Sync puts into the world. A season's file with errors stops the build.
 * A season that is not in `ship` is not built there: the real one stays off the server until its opening day,
 * because a boss killed while its advancement exists cannot be earned again when the season starts (docs/34 §8).
 */
export async function buildSeasons(paths: { seasons: string; dist: string; items?: string }, log: (s: string) => void): Promise<string[]> {
  const { seasons, index, issues } = await loadSeasons(paths.seasons, paths.items);
  if (issues.length) throw new Error(`season files have errors:\n${issues.map((i) => `  ${i.season}: ${i.message}`).join("\n")}`);
  const out = path.join(paths.dist, "server", "datapacks");
  await mkdir(out, { recursive: true });
  // a season taken out of `ship` leaves dist/, so the next Sync does not carry it on
  for (const name of await readdir(out)) {
    const m = /^deepslate-(season|frontier)-(.+)$/.exec(name);
    if (!m) continue;
    const wanted = index.ship.includes(m[2]!) || (m[1] === "frontier" && index.frontiers.includes(m[2]!));
    if (!wanted) await rm(path.join(out, name), { recursive: true, force: true });
  }
  const built: string[] = [];
  for (const s of seasons.filter((x) => index.ship.includes(x.id))) {
    await writeSeasonDatapack(s, out);
    built.push(s.id);
    log(`season datapack ${seasonPackName(s.id)}: ${s.bosses.length} bosses, ${s.trials.length} trials`);
    const frontier = frontierDatapack(s);
    if (frontier && s.frontier) {
      await writePack(path.join(out, frontierPackName(s.id)), frontier);
      log(`frontier datapack ${frontierPackName(s.id)}: ${s.frontier.dimension} on ${s.frontier.noise} (it counts from the server's next start)`);
    } else await rm(path.join(out, frontierPackName(s.id)), { recursive: true, force: true });
  }
  // a Frontier ahead of its season: the dimension and the portal's tags, and nothing that can be earned
  for (const s of seasons.filter((x) => index.frontiers.includes(x.id) && !index.ship.includes(x.id))) {
    const frontier = frontierDatapack(s);
    if (!frontier || !s.frontier) continue;
    await writePack(path.join(out, frontierPackName(s.id)), frontier);
    log(`frontier datapack ${frontierPackName(s.id)} alone: ${s.frontier.dimension} on ${s.frontier.noise} (it counts from the server's next start)`);
  }
  if (built.length === 0) log(`seasons: ${seasons.length} file(s) lint clean, none in "ship", no season datapack built`);
  return built;
}
