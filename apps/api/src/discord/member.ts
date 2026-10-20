// docs/04: whether a Discord account is in the group's Discord server, asked by the bot. Sign-in through Authentik
// hands the site no Discord token of the member's, so the site asks api (GET /discord/member/:id) instead.
// Three answers, as at the site's own Discord sign-in (docs/35 R-12): true, false, and null when there is no bot or
// Discord gave no clear answer. Null is never read as "left the server".

export const DISCORD_ID_RE = /^\d{5,25}$/;

/** Discord's error codes that mean "not a member": Unknown Member, Unknown User. Unknown Guild (the bot's own setup) is not one. */
const NOT_A_MEMBER = new Set([10007, 10013]);

export async function guildMemberByBot(env: { DISCORD_BOT_TOKEN?: string; DISCORD_GUILD_ID?: string }, discordId: string, f: typeof fetch = fetch): Promise<boolean | null> {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID || !DISCORD_ID_RE.test(discordId)) return null;
  const res = await f(`https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/members/${discordId}`, {
    headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);
  if (!res) return null;
  if (res.status === 200) return true;
  if (res.status !== 404) return null; // rate limit, outage, a bot without access
  const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
  return typeof body?.code === "number" && NOT_A_MEMBER.has(body.code) ? false : null;
}
