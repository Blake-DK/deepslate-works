import { z } from "zod";

// modpack/mods.json is the single source of truth (docs/06). This schema is shared by the CLI and the web app.

export const LOADS = ["L", "M", "H"] as const;
export const SIDES = ["both", "client", "server"] as const;

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
});

export const categorySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1),
  blurb: z.string().max(300).default(""),
  votable: z.boolean().default(true), // base pack and server-only categories are not voted on
});

export const manifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  minecraft: z.literal("1.21.1"),
  loader: z.literal("neoforge"),
  neoforge: z.string().default("latest"),
  server_address: z.string().min(1),
  profile: z.object({ id: z.string(), dir: z.string(), icon: z.string() }),
  ram: z.object({ min_gb: z.number().int().min(2), max_gb: z.number().int().max(16) }),
  categories: z.array(categorySchema).min(1),
  mods: z.array(modSchema).min(1),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type Mod = z.infer<typeof modSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Load = (typeof LOADS)[number];
export type Video = z.infer<typeof videoSchema>;
