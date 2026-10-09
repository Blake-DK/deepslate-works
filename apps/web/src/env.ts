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
  // docs/42: TEST_MODE=1 only in deepslate-web-test, the test server's site; LIVE_SITE_URL and LIVE_MODPACK_DIR are its
  // way back to the live site. TEST_STACK, TEST_SITE_URL, TEST_API_URL and TEST_SUMMARY_TOKEN are the live site's way to
  // the test server (the Control Room card, the Live | Test switch); nothing of them shows unless TEST_STACK=1.
  TEST_MODE: str("TEST_MODE") === "1",
  LIVE_SITE_URL: str("LIVE_SITE_URL").replace(/\/+$/, ""),
  LIVE_MODPACK_DIR: str("LIVE_MODPACK_DIR"),
  TEST_STACK: str("TEST_STACK") === "1",
  TEST_SITE_URL: str("TEST_SITE_URL").replace(/\/+$/, ""),
  TEST_API_URL: str("TEST_API_URL", "http://deepslate-wg:4001"),
  TEST_SUMMARY_TOKEN: str("TEST_SUMMARY_TOKEN"),
  // docs/45: the launcher's Test section; the live web's own token for the test api's /test/app/*, never sent to the app
  TEST_APP_TOKEN: str("TEST_APP_TOKEN"),
  isProd: process.env.NODE_ENV === "production",
  get discordEnabled() {
    return Boolean(this.DISCORD_CLIENT_ID && this.DISCORD_CLIENT_SECRET);
  },
  get secureCookies() {
    return this.AUTH_URL.startsWith("https://");
  },
  /** The other site of the pair, for the Live | Test switch: null when there is none to switch to. */
  get otherSite(): { label: "Live" | "Test"; url: string } | null {
    if (this.TEST_MODE) return this.LIVE_SITE_URL ? { label: "Live", url: this.LIVE_SITE_URL } : null;
    return this.TEST_STACK && this.TEST_SITE_URL ? { label: "Test", url: this.TEST_SITE_URL } : null;
  },
};

export function missingEnv(): string[] {
  return ["DATABASE_URL", "AUTH_SECRET", "AUTH_URL"].filter((k) => !process.env[k]);
}
