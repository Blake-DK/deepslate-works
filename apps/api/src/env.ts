import { z } from "zod";

// Fail fast: api must never start half-configured, it is the only thing that can reach the homelab.
const schema = z.object({
  PORT: z.coerce.number().int().default(4000),
  API_SERVICE_TOKEN: z.string().min(32, "API_SERVICE_TOKEN must be at least 32 chars"),
  AMP_URL: z.string().url().default("http://10.77.0.2:8080"),
  AMP_INSTANCE_ID: z.string().default(""),
  AMP_USERNAME: z.string().default("webapp"),
  AMP_PASSWORD: z.string().default(""),
  AMP_MOCK: z.enum(["0", "1"]).default("0"),
  AMP_TUNNEL_IP: z.string().default("10.77.0.2"),
  RSYNC_TARGET: z.string().default("amp@10.77.0.2:"),
  DEPLOY_KEY_PATH: z.string().default("/run/keys/deploy.key"),
  DATABASE_URL: z.string().min(1),
  PORTAL_URL: z.string().url().default("https://deepslate.dsw.test"),
  LIMBO_POS: z.string().regex(/^-?\d+ -?\d+ -?\d+$/).default("0 250 0"),
  SPAWN_POS: z.string().regex(/^-?\d+ -?\d+ -?\d+$/).optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_GUILD_ID: z.string().optional(),
  // modpack build (runs as a child process of api): the repo mounts and the CLI's location in the image
  REPO_DIR: z.string().default("/repo"),
  MODPACK_PKG_DIR: z.string().default("/app/packages/modpack"),
  MODRINTH_USER_AGENT: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Empty values in deploy/.env (e.g. `SPAWN_POS=`) mean "unset".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`api: bad environment\n${lines}`);
  }
  return parsed.data;
}
