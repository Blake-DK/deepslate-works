import type { Env } from "../env.js";

// docs/42a (2026-10-08): only one instance talks to the players' Discord, and it says so. The api of an instance
// without DISCORD_TALKS=1 (the test server, or any new one) has no bot and none of the players' webhooks: no feed line,
// no forum post, no presence, no slash command, and no chat from the Discord game chat into its server. Every outbound
// path is made from what this file hands out (server.ts: the feed's three webhooks; wire.ts: the bot), so an event kind
// added later is silent there without anyone remembering. Reading Discord for the door (is this member still in the
// server, limbo.ts) and signing in (web) do not post and are not gated.

type GateEnv = Pick<Env, "DISCORD_TALKS" | "DISCORD_WEBHOOK_FEED" | "DISCORD_WEBHOOK_ADMIN" | "DISCORD_WEBHOOK_UPDATES" | "DISCORD_PRIVATE_WEBHOOK_FEED" | "DISCORD_PRIVATE_WEBHOOK_ADMIN" | "DISCORD_PRIVATE_WEBHOOK_UPDATES">;

/** True only when the instance is marked as the one that talks to the players' Discord. Absent or anything else: off. */
export function talksToDiscord(env: Pick<Env, "DISCORD_TALKS">): boolean {
  return env.DISCORD_TALKS === "1";
}

/**
 * The webhooks this instance may post to. Marked: the players' channels. Not marked: only a private channel's
 * webhooks (DISCORD_PRIVATE_WEBHOOK_*, the test server's TEST_DISCORD_WEBHOOK_* in deploy/.env), else none: silent.
 */
export function discordOutlets(env: GateEnv): { talks: boolean; feed: string | undefined; admin: string | undefined; updates: string | undefined } {
  if (talksToDiscord(env)) return { talks: true, feed: env.DISCORD_WEBHOOK_FEED || undefined, admin: env.DISCORD_WEBHOOK_ADMIN || undefined, updates: env.DISCORD_WEBHOOK_UPDATES || undefined };
  return { talks: false, feed: env.DISCORD_PRIVATE_WEBHOOK_FEED || undefined, admin: env.DISCORD_PRIVATE_WEBHOOK_ADMIN || undefined, updates: env.DISCORD_PRIVATE_WEBHOOK_UPDATES || undefined };
}
