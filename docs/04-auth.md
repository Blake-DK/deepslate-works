# 04 · Auth and access

## Goals

- Nobody outside the group can see anything, not even the login page's contents beyond a "sign in" button.
- Friends log in with something they already have. Discord is that thing.
- One person without Discord can still get in.
- The live map (a separate service) is covered by the same login.

## Flow

1. Admin creates an invite in `/admin/invites` (note: "for Gordon", expires in 7 days). App shows a link `https://deepslate.dsw.test/join/<code>`.
2. Friend opens the link. Page: server name, one line about what it is, a **Continue with Discord** button, and a small "No Discord?" link.
3. Discord OAuth (`identify` scope only). On callback, if the invite is valid and unused: create `User` with `discordId`, `displayName` from Discord, mark invite used. If the Discord account already has a user: just log in (invite not consumed).
4. "No Discord?" → form: display name, email, password (min 12 chars). Creates a credentials user against the same invite.
5. After first login, an onboarding step asks for their **Minecraft username** (validated against the Mojang API, stores `mcUuid`) and their **PC tier** (three plain-English options with RAM/GPU hints, used to tailor warnings and installer defaults).

Direct visits to `/login` without an invite show only "Continue with Discord" and "Sign in with email"; a Discord account that isn't linked to a user gets "You need an invite from Alex", nothing else.

## Sessions

- Auth.js JWT sessions in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie scoped to `Domain=.deepslate.dsw.test` so `map.deepslate.dsw.test` shares it and nothing else on dsw.test sees it.
- `web` → `api` calls carry `Authorization: Bearer <API_SERVICE_TOKEN>` plus `X-User-Id`, `X-User-Role`, `X-Mc-Username` from the verified session; `api` rejects anything without the token and re-validates the rest.
- Optional Discord server gate: with `DISCORD_GUILD_ID` set, the app requests the `guilds` scope and refuses Discord sign-ins from accounts that are not members of that server. With `DISCORD_GUILD_AUTO_JOIN=1`, membership counts as the invite.
- Session lifetime 30 days, refreshed on activity.
- `GET /api/auth/verify` returns 200 if the request carries a valid session, 401 otherwise. Caddy's `forward_auth` uses it for BlueMap.

## Admin bootstrap

- `ADMIN_DISCORD_ID` in `.env`. The first login from that Discord id becomes ADMIN without an invite. Any other admin is promoted from the users page.

## Rate limits and abuse

- Login and invite endpoints: 10 requests / minute / IP at Caddy.
- Player server actions: per-user limits defined per action (see 08-api.md), enforced in the app.
- Failed logins logged to `AuditLog` with `userId = null`.

## Things not to do

- No public registration, no "request access" form. An invite link in the Discord group is the whole onboarding.
- No storing Discord tokens beyond the login; we only need the id and name.
- Never put the AMP password, RCON password or Discord client secret anywhere but `.env`.
