# 04 · Auth and access

## Goals

- Nobody outside the group can see anything, not even the login page's contents beyond a "sign in" button.
- Friends log in with something they already have. Discord is that thing.
- One person without Discord can still get in.
- The live map (a separate service) is covered by the same login.

## Flow

**The usual way in: the Discord server is the invite.**

1. A friend who is in the group's Discord server opens `https://deepslate.dsw.test` and presses **Continue with Discord**.
2. Discord OAuth (scopes `identify` and, because the server gate is on, `guilds`). With `DISCORD_GUILD_ID` set, an account that is not in that server is refused; with `DISCORD_GUILD_AUTO_JOIN=1`, one that is in it gets a `User` without any invite. Both are set in production.
3. After the first sign-in, one question: roughly what their PC is like (three plain options). It is a first guess; the installer measures the PC and replaces it (`pcTierSource`, docs/07). **Nobody is asked for a Minecraft name.**

**The one without Discord.**

1. An admin creates an invite in `/admin/invites` (note: "for Gordon", expires in 7 days). The site shows a link `https://deepslate.dsw.test/join/<code>`.
2. The link's page has **Continue with Discord** and a small "No Discord?" link, which leads to a form: display name, email, password (12 characters at least). That makes a credentials user against the invite.

Direct visits to `/login` show only "Continue with Discord" and "Sign in with email".

**The Minecraft account** is bound in the game, not on the site (docs/14): whoever joins the server and is not known lands in the entrance room with a link in chat, `/link/<code>`. Opening it signed in binds that Minecraft account (`mcUuid`, `mcUsername`, `verifiedAt`) to that member. An admin can take the binding away, or make one by name, on Admin → Players.

**The installer** signs in by itself (`LauncherAuth`): it shows a code and opens `/launcher/<code>`; the member, signed in, approves; the script is given a token that is good for seven days and for three things: the mod list, the downloads, and sending its report. `POST /api/launcher/start`, `GET /api/launcher/poll`.

## Who may do what before the site is live

Signing in is one thing, using the site another. Until "We're live" is switched on (Admin → Settings), a PLAYER sees a launch page: no address, no downloads, no Play button. Admins see everything. A PLAYER with **early access** (a switch on Admin → Players) is treated as if the site were live, and sees a banner that says so. The rules are one file, `src/shared/access.ts`, used by the pages, the download routes and the door of the server alike (docs/13 §9).

## Sessions

- Auth.js JWT sessions in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie scoped to `Domain=.deepslate.dsw.test` so `map.deepslate.dsw.test` shares it and nothing else on dsw.test sees it.
- `web` → `api` calls carry `Authorization: Bearer <API_SERVICE_TOKEN>` plus who is asking, from the verified session (`X-User-Id`, `X-User-Role` and, where there is one, `X-Mc-Username`); `api` rejects anything without the token and checks the role for every route. `src/server/api-client.ts` is the only place that makes such a call.
- Leaving the Discord server: `guildMember` is looked at again at every Discord sign-in, and, if `DISCORD_BOT_TOKEN` is set (it is not, 2026-09-29), by `api` every five minutes for whoever is on the server. Somebody who has left is sent back to the entrance room at their next join.
- Session lifetime 30 days, refreshed on activity.
- `GET /api/auth/verify` returns 200 if the request carries a valid session, 401 otherwise. Caddy's `forward_auth` uses it for BlueMap.

## Admin bootstrap

- `ADMIN_DISCORD_ID` in `.env`. The first login from that Discord id becomes ADMIN without an invite. Any other admin is promoted from the users page.

## Rate limits and abuse

- Sign-in and invite routes: 10 requests a minute for each address, counted in the app (`src/server/auth/rate-limit.ts`); the Caddy on this VPS has no module for it.
- Failed sign-ins are in the event log ("tried to sign in"), without a member's name.
- Actions in the game by players (Phase 4) will carry limits of their own; none exist yet.

## Things not to do

- No public registration, no "request access" form. Being in the Discord server is the whole onboarding; an invite link is for the one who is not.
- No storing Discord tokens beyond the login; we only need the id and name.
- Never put the AMP password, RCON password or Discord client secret anywhere but `.env`.
