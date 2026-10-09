import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// api gets an explicit environment in deploy/docker-compose.yml, not the whole .env. A variable env.ts reads but the
// list leaves out is silently unset in production: on 2026-10-07 SERVER_ADDRESS was missing, which switched off the
// guard that keeps Admin → Server → Router from removing the route players join by.
const envTs = readFileSync(new URL("../src/env.ts", import.meta.url), "utf8");
const compose = readFileSync(new URL("../../../deploy/docker-compose.yml", import.meta.url), "utf8");

/** Set by the image itself, never from deploy/.env. */
const FROM_THE_IMAGE = new Set(["PORT", "REPO_DIR", "MODPACK_PKG_DIR"]);
/** docs/42: only the test server's api has these; the live one must not (TEST_MODE unset is what keeps live as it was). */
// docs/42a (2026-10-08): and a private Discord channel's webhooks, which the live api never reads (it talks to the players')
const TEST_ONLY = new Set(["TEST_MODE", "TEST_SUMMARY_TOKEN", "TEST_APP_TOKEN", "SEASONS_SHIP", "DISCORD_PRIVATE_WEBHOOK_FEED", "DISCORD_PRIVATE_WEBHOOK_ADMIN", "DISCORD_PRIVATE_WEBHOOK_UPDATES"]);
/** docs/42 §10: the test server has no bot. */
// docs/42a (2026-10-08): silent on Discord: no bot, not marked as the one that talks to it, none of the players' webhooks
const NOT_ON_TEST = new Set(["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_TALKS", "DISCORD_PLAYER_ROLE_ID", "DISCORD_WEBHOOK_FEED", "DISCORD_WEBHOOK_ADMIN", "DISCORD_WEBHOOK_UPDATES"]);

const block = (service: string) => {
  const from = compose.slice(compose.indexOf(`\n  ${service}:`));
  const env = from.slice(from.indexOf("\n    environment:"), from.indexOf("\n    volumes:"));
  return new Set([...env.matchAll(/^ {6}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]!));
};

describe("api's environment in compose", () => {
  const read = [...envTs.matchAll(/^ {2}([A-Z][A-Z0-9_]+): z\./gm)].map((m) => m[1]!);

  it("passes every variable env.ts reads", () => {
    expect(read.length).toBeGreaterThan(20);
    const passed = block("api");
    expect(read.filter((k) => !FROM_THE_IMAGE.has(k) && !TEST_ONLY.has(k) && !passed.has(k))).toEqual([]);
    expect([...TEST_ONLY].filter((k) => passed.has(k))).toEqual([]);
  });

  it("docs/42: the test server's api gets them too, TEST_MODE among them, and no bot", () => {
    const passed = block("api-test");
    expect(read.filter((k) => !FROM_THE_IMAGE.has(k) && !NOT_ON_TEST.has(k) && !passed.has(k))).toEqual([]);
    expect([...NOT_ON_TEST].filter((k) => passed.has(k))).toEqual([]);
    expect(compose).toMatch(/\n {2}api-test:\n {4}profiles: \[test\]\n/);
    expect(compose).toMatch(/\n {2}web-test:\n {4}profiles: \[test\]\n/);
  });
});
