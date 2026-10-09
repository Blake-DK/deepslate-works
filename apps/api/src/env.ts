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
  // the mc-router dashboard on the AMP host (Admin → Server → Router), over the tunnel; it has no login of its own
  ROUTER_DASH_URL: z.string().url().default("http://10.77.0.2:8090"),
  // the address players join by (also web's); its route is never removed from Admin → Server → Router
  SERVER_ADDRESS: z.string().optional(),
  RSYNC_TARGET: z.string().default("amp@10.77.0.2:"),
  DEPLOY_KEY_PATH: z.string().default("/run/keys/deploy.key"),
  DATABASE_URL: z.string().min(1),
  PORTAL_URL: z.string().url().default("https://deepslate.dsw.test"),
  // docs/14: where someone who waits stands, "<dimension> x y z"; without a dimension it is the overworld
  LIMBO_POS: z.string().regex(/^(?:[a-z0-9_.-]{1,64}:[a-z0-9_./-]{1,64} )?-?\d+(?:\.\d+)? -?\d+(?:\.\d+)? -?\d+(?:\.\d+)?$/).default("deepslate:limbo 0.5 65 0.5"),
  // where someone who is let in stands, in the overworld; unset = spread around 0, 0
  SPAWN_POS: z.string().regex(/^-?\d+(?:\.\d+)? -?\d+(?:\.\d+)? -?\d+(?:\.\d+)?$/).optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_GUILD_ID: z.string().optional(),
  // docs/21, the Discord feed: webhooks of the channel the server posts to and of a private admin channel. A URL that is
  // not a Discord webhook does not stop api: the feed treats it as refused and says so on the settings card.
  DISCORD_WEBHOOK_FEED: z.string().optional(),
  DISCORD_WEBHOOK_ADMIN: z.string().optional(),
  // docs/22: the forum channel season-updates (votes, season posts, news), and the Discord app's id (not a secret) for
  // the slash commands and the "Add the bot" link. The bot itself is DISCORD_BOT_TOKEN.
  DISCORD_WEBHOOK_UPDATES: z.string().optional(),
  // docs/42a (2026-10-08): "1" marks the one instance that talks to the players' Discord (the bot and the three webhooks
  // above). Absent: silent (discord/gate.ts). The live api's compose service sets it; nothing else does.
  DISCORD_TALKS: z.string().optional(),
  // planner 2026-10-09: the Discord role on everyone who plays (discord/role.ts). Empty: the feature is off.
  DISCORD_PLAYER_ROLE_ID: z.string().optional(),
  // A private channel for an instance that is not marked (the test server), set through deploy/.env; empty: silent.
  DISCORD_PRIVATE_WEBHOOK_FEED: z.string().optional(),
  DISCORD_PRIVATE_WEBHOOK_ADMIN: z.string().optional(),
  DISCORD_PRIVATE_WEBHOOK_UPDATES: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(), // used only when it looks like an id
  // modpack build (runs as a child process of api): the repo mounts and the CLI's location in the image
  REPO_DIR: z.string().default("/repo"),
  MODPACK_PKG_DIR: z.string().default("/app/packages/modpack"),
  MODRINTH_USER_AGENT: z.string().optional(),
  // GeoLite2-Country database for the analytics page; unset or missing = no countries
  GEOIP_DB: z.string().default("/geoip/GeoLite2-Country.mmdb"),
  // docs/42: 1 only in deepslate-api-test, the test server's own api. Unset on live, where nothing below does anything.
  TEST_MODE: z.enum(["0", "1"]).default("0"),
  // docs/42 T9: the live site's token for GET /test/summary; it opens nothing else
  TEST_SUMMARY_TOKEN: z.string().min(32, "TEST_SUMMARY_TOKEN must be at least 32 chars").optional(),
  // docs/45: the live web's token for the launcher's Test section (/test/app/*), on the test server only; opens nothing else
  TEST_APP_TOKEN: z.string().optional(),
  // docs/42 T5: the seasons a test Build makes datapacks of, in place of index.json's `ship` ("s1" or "s1,sample")
  SEASONS_SHIP: z.string().regex(/^[a-z0-9_, ]{0,200}$/, "SEASONS_SHIP: season ids, separated by commas").optional(),
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
