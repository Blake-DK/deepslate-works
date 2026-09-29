// SHARED FILE: apps/web/src/shared/ and apps/api/src/shared/ hold identical copies (a test compares them).
// Edit the copy in apps/web, then `cp apps/web/src/shared/*.ts apps/api/src/shared/`.
//
// docs/16 §5 and §6: what the Setting table holds, one row per section, with the defaults used when a
// row (or a field) is missing. Anything read from the database goes through `parseSection`.
import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const sections = {
  privacy: z.object({
    geo: z.boolean().default(true), // look up the country of a player's address (local database)
    chat: z.boolean().default(true), // keep chat lines in the event log
    analyticsForPlayers: z.boolean().default(true), // players may open /analytics
  }),
  retention: z.object({
    chatDays: z.number().int().min(1).max(3650).default(30),
    eventDays: z.number().int().min(7).max(3650).default(180),
    ipDays: z.number().int().min(1).max(365).default(30),
  }),
  files: z.object({
    maxDownloadMb: z.number().int().min(1).max(500).default(50),
    maxPreviewKb: z.number().int().min(16).max(8192).default(2048),
    denied: z.array(z.string().min(1).max(200)).max(100).default(["world/", "world_*", "*.dat", "*.dat_old", "*.mca", "backups/", "LocalBackups/", "session.lock", "AMP_Logs/", "*.key", "*.pem"]),
  }),
  branding: z.object({
    name: z.string().trim().min(1).max(40).default("Deepslate Works"),
    tagline: z.string().trim().max(120).default("Invite only. Minecraft 1.21.1 · NeoForge."),
    accent: hex.default("#b8652c"),
    accentDark: hex.default("#d9823f"),
    defaultTheme: z.enum(["light", "dark", "system"]).default("system"),
    discordInvite: z.string().trim().url().max(200).or(z.literal("")).default(""),
    footer: z.string().trim().max(200).default(""),
    rules: z.string().max(8000).default(""),
    motd: z.string().trim().max(59).default("Deepslate Works"),
    logo: z.string().max(80).default(""), // file name under data/branding, "" = none
    favicon: z.string().max(80).default(""),
    banner: z.string().max(80).default(""),
  }),
} as const;

export type SectionName = keyof typeof sections;
export const SECTION_NAMES = Object.keys(sections) as SectionName[];
export type Section<K extends SectionName> = z.infer<(typeof sections)[K]>;

/** Defaults for anything missing or invalid: a bad row in the database never takes a page down. */
export function parseSection<K extends SectionName>(name: K, value: unknown): Section<K> {
  const schema = sections[name];
  const given = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const whole = schema.safeParse(given);
  if (whole.success) return whole.data as Section<K>;
  // keep the fields that are fine, default the rest
  const good: Record<string, unknown> = {};
  for (const [k, field] of Object.entries(schema.shape) as Array<[string, z.ZodTypeAny]>) {
    const r = field.safeParse(given[k]);
    if (r.success && given[k] !== undefined) good[k] = r.data;
  }
  return schema.parse(good) as Section<K>;
}

/** `*` matches within one path segment; a pattern ending in `/` matches that folder anywhere and all below it. */
export function isDenied(path: string, denied: readonly string[]): boolean {
  const clean = path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!clean) return false;
  const parts = clean.split("/");
  if (parts.some((p) => p === ".." || p === ".")) return true;
  const glob = (pat: string) => new RegExp(`^${pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")}$`, "i");
  for (const raw of denied) {
    const pat = raw.trim().replace(/^\/+/, "");
    if (!pat) continue;
    if (pat.endsWith("/")) {
      const re = glob(pat.slice(0, -1));
      if (parts.some((seg) => re.test(seg))) return true;
    } else if (pat.includes("/")) {
      if (glob(pat).test(clean)) return true;
    } else {
      const re = glob(pat);
      if (parts.some((seg) => re.test(seg))) return true;
    }
  }
  return false;
}
