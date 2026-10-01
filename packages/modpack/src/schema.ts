import { z } from "zod";

// modpack/mods.json is the single source of truth (docs/06). This schema is shared by the CLI and the web app.

export const LOADS = ["L", "M", "H"] as const;
export const SIDES = ["both", "client", "server"] as const;
/** What a pack entry is: a mod jar (mods/), a resource pack (resourcepacks/) or a shader pack for Iris (shaderpacks/). */
export const KINDS = ["mod", "resourcepack", "shader"] as const;
/** The shader choices on the Me page besides "none" (planner, 2026-10-01). */
export const SHADERS = ["light", "full"] as const;
export type Kind = (typeof KINDS)[number];
export type ShaderChoice = "none" | (typeof SHADERS)[number];

export const videoSchema = z.object({
  title: z.string().min(1),
  url: z.string().url().regex(/^https:\/\/(www\.)?youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}/, "YouTube watch URL"),
});

export const modSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "Modrinth slug"),
  name: z.string().min(1),
  category: z.string().min(1),
  side: z.enum(SIDES),
  enabled: z.boolean(),
  load: z.enum(LOADS),
  recommended: z.boolean().default(false),
  hidden: z.boolean().default(false), // dependencies pulled in at lock time; never shown or voted on
  exclusiveGroup: z.string().nullable().default(null),
  description: z.string().min(1).max(240),
  note: z.string().max(160).optional(), // shown small on the card, e.g. "Needs Mekanism"
  wiki: z.string().url(),
  videos: z.array(videoSchema).max(3).default([]),
  version: z.string().default("latest"), // "latest" or a Modrinth version id
  requires: z.array(z.string()).default([]),
  kind: z.enum(KINDS).default("mod"),
  shader: z.enum(SHADERS).optional(), // kind "shader" only: which Me page choice installs it
});

export const categorySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1),
  blurb: z.string().max(300).default(""),
  votable: z.boolean().default(true), // base pack and server-only categories are not voted on
  // Client-only extras each member switches on for themselves on the Me page (category "visuals"). Never on the server,
  // never voted on; the mod list hands them only to members who chose them.
  optional: z.boolean().default(false),
});

export const TIERS = ["LOW", "MID", "HIGH"] as const;
export type Tier = (typeof TIERS)[number];
/** Chunks, as options.txt holds them: renderDistance and simulationDistance. */
export const distanceSchema = z.object({ render: z.number().int().min(2).max(32), simulation: z.number().int().min(5).max(32) });

export const manifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  minecraft: z.literal("1.21.1"),
  loader: z.literal("neoforge"),
  neoforge: z.string().default("latest"),
  server_address: z.string().min(1),
  profile: z.object({ id: z.string(), dir: z.string(), icon: z.string() }),
  ram: z.object({ min_gb: z.number().int().min(2), max_gb: z.number().int().max(16) }),
  // What server.properties is expected to hold. Not pushed anywhere (AMP writes that file from its own
  // settings on every start); Admin → Files shows where the live file differs.
  server_properties: z.record(z.string().regex(/^[a-z0-9._-]+$/), z.string().max(200)).default({}),
  // What the installer sets in options.txt, by the PC tier measured for the member (docs/07 "Render distance").
  render_by_tier: z.object({ LOW: distanceSchema, MID: distanceSchema, HIGH: distanceSchema }).default({
    LOW: { render: 8, simulation: 6 }, MID: { render: 8, simulation: 6 }, HIGH: { render: 8, simulation: 6 },
  }),
  categories: z.array(categorySchema).min(1),
  mods: z.array(modSchema).min(1),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type Mod = z.infer<typeof modSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Load = (typeof LOADS)[number];
export type Video = z.infer<typeof videoSchema>;

/** The render and simulation distance for a member's PC tier. No tier known: the weak PC's, which is safe anywhere. */
export function distancesFor(m: Pick<Manifest, "render_by_tier">, tier: string | null | undefined): { render: number; simulation: number } {
  return (TIERS as readonly string[]).includes(tier ?? "") ? m.render_by_tier[tier as Tier] : m.render_by_tier.LOW;
}
