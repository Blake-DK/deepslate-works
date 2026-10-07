// Central place for environment variables. Nothing throws at import time so
// `next build` works without a .env; /api/health reports what is missing.
const str = (k: string, fallback = "") => process.env[k] ?? fallback;

export const env = {
  SITE_NAME: "Deepslate Works",
  AUTH_URL: str("AUTH_URL", "http://localhost:3000"),
  COOKIE_DOMAIN: str("COOKIE_DOMAIN") || undefined,
  DISCORD_CLIENT_ID: str("DISCORD_CLIENT_ID"),
  DISCORD_CLIENT_SECRET: str("DISCORD_CLIENT_SECRET"),
  ADMIN_DISCORD_ID: str("ADMIN_DISCORD_ID"),
  DISCORD_GUILD_ID: str("DISCORD_GUILD_ID"),
  DISCORD_GUILD_AUTO_JOIN: str("DISCORD_GUILD_AUTO_JOIN", "0") === "1",
  API_URL: str("API_URL"),
  API_SERVICE_TOKEN: str("API_SERVICE_TOKEN"),
  MANIFEST_KEY: str("MANIFEST_KEY"),
  MAP_URL: str("MAP_URL"),
  SERVER_ADDRESS: str("SERVER_ADDRESS", "mc.dsw.test"),
  // docs/39: the build designer's container; without DESIGNER_URL the card says "Not set up"
  DESIGNER_URL: str("DESIGNER_URL"),
  DESIGNER_TOKEN: str("DESIGNER_TOKEN"),
  DESIGNER_DAILY: Math.max(1, Number.parseInt(str("DESIGNER_DAILY", "80"), 10) || 80),
  isProd: process.env.NODE_ENV === "production",
  get discordEnabled() {
    return Boolean(this.DISCORD_CLIENT_ID && this.DISCORD_CLIENT_SECRET);
  },
  get secureCookies() {
    return this.AUTH_URL.startsWith("https://");
  },
};

export function missingEnv(): string[] {
  return ["DATABASE_URL", "AUTH_SECRET", "AUTH_URL"].filter((k) => !process.env[k]);
}
