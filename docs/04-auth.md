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

**The one who is not in the Discord server: an invite link (Alex, 2026-10-04).**

1. An admin creates an invite in `/admin/invites` (note: "for Gordon", expires in 7 days). The site shows a link `https://deepslate.dsw.test/join/<code>`.
2. The link's page has **Continue with Discord** and a small "No Discord?" link, which leads to a form: display name, email, password (12 characters at least). That makes a credentials user against the invite.
3. **An invite stands in for the Discord server.** Whoever comes in by an invite link is let in whether or not their Discord account is in the server, and is marked `User.outsideAuth` (migration `0027_outside_auth`): the server rule is never applied to them, at sign-in, at linking, at the door of the game, or when the bot sees them leave. `guildMember` still records what Discord last said. The decision at a Discord sign-in is one pure function, `discordDoor` (`src/server/auth/discord-door.ts`).
4. **The outside list** is Admin → People → Players → "Outside Discord"; those on it carry an "invited" badge. A member's menu has "Let in without the Discord server" and "Apply the Discord server rule" (the way off the list: someone taken off while not in the server is signed out everywhere and, if playing, taken out, like someone who has just left). A member who left the server and opens a new invite link is put on the list by it. Members invited before this existed are not on the list; the menu puts them there.
5. **What a refused sign-in says** (`/login?error=…`): `not-in-server` (not in the Discord server and no invite: join it, or ask for an invite link), `discord-unavailable` (Discord gave no answer about the server, docs/35 R-12: the sign-in is refused and nothing about the member is changed; try again), `invite-invalid` (came by a link that has been used or has run out: ask for a new one), `no-invite` (the server rule is off or auto-join is off, and there was no link). The link's own page says used, expired or not right before anyone signs in.

Direct visits to `/login` show only "Continue with Discord" and "Sign in with email".

**The Minecraft account** is bound in the game, not on the site (docs/14): whoever joins the server and is not known lands in the entrance room with a link in chat, `/link/<code>`. Opening it signed in binds that Minecraft account (`mcUuid`, `mcUsername`, `verifiedAt`) to that member. An admin can take the binding away, or make one by name, on Admin → Players.

**The installer** signs in by itself (`LauncherAuth`): it shows a code and opens `/launcher/<code>`; the member, signed in, approves; the script is given a token that is good for seven days and for three things: the mod list, the downloads, and sending its report. `POST /api/launcher/start`, `GET /api/launcher/poll`.

## Who may do what before the site is live

Signing in is one thing, using the site another. Until "We're live" is switched on (Admin → Settings), a PLAYER sees a launch page: no address, no downloads, no Play button. Admins see everything. A PLAYER with **early access** (a switch on Admin → Players) is treated as if the site were live, and sees a banner that says so. The rules are one file, `src/shared/access.ts`, used by the pages, the download routes and the door of the server alike (docs/13 §9).

## Sessions

- Auth.js JWT sessions in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie scoped to `Domain=.deepslate.dsw.test` so `map.deepslate.dsw.test` shares it and nothing else on dsw.test sees it.
- `web` → `api` calls carry `Authorization: Bearer <API_SERVICE_TOKEN>` plus who is asking, from the verified session (`X-User-Id`, `X-User-Role` and, where there is one, `X-Mc-Username`); `api` rejects anything without the token and checks the role for every route. `src/server/api-client.ts` is the only place that makes such a call.
- Leaving the Discord server: `guildMember` is looked at again at every Discord sign-in, and, if `DISCORD_BOT_TOKEN` is set (it is not, 2026-09-29), by `api` every five minutes for whoever is on the server. Somebody who has left is sent back to the entrance room at their next join, unless an invite brought them (`outsideAuth`, above).
- Session lifetime 30 days, refreshed on activity; 12 hours for admin password and break-glass sessions (below).
- `GET /api/auth/verify` returns 200 if the request carries a valid session, 401 otherwise. Caddy's `forward_auth` uses it for BlueMap. `GET /api/auth/verify/admin` is the same for the mc-router dashboard host, with 403 for a member who is not an admin (docs/02). Both live in `src/server/auth/verify.ts`.

## Admin password sign-in (planner, 2026-10-01)

For admins only, for the day Discord is down or an admin's Discord account is gone. Discord stays the way in for everyone; the sign-in page has a small "Admin sign-in" link under the Discord button, not a second button.

- **What it takes**: username + password + a 6-digit code from an authenticator app (TOTP, RFC 6238, SHA-1, 30 s, one step of drift either way), or one unused recovery code in place of the code. All three every time; there is no password-only path. A code is accepted once (`AdminLogin.lastStep`).
- **Setting it up** (`/me/sign-in`; from the Me page, or a member's own row on Admin → People): username (3 to 32, `a-z0-9._-`), password (at least 12 characters, not among the common ones in `src/server/auth/common-passwords.ts`, not the username, not one character repeated), then the authenticator: QR code and the key to type by hand. It is switched on only when a code from the app has been confirmed. Then 10 recovery codes are shown, once.
- **Storage** (`AdminLogin`, migration 0017): password argon2id (19 MiB, 2 passes, 1 lane; `@node-rs/argon2`); the authenticator secret AES-256-GCM with a key made from `TOTP_SEAL_KEY` (`.env`, optional) or, without it, from `AUTH_SECRET`, so a copy of the database alone cannot make codes; recovery codes only as an HMAC (made from `AUTH_SECRET`). The sealed string says which key sealed it (`v1` from `AUTH_SECRET`, `v2` from `TOTP_SEAL_KEY`); an old one is sealed again with `TOTP_SEAL_KEY` after its admin's next good code (`src/server/auth/seal.ts`). Without `TOTP_SEAL_KEY`, a new `AUTH_SECRET` makes every authenticator unreadable (everyone sets theirs up again) as well as ending every session; docs/09 has the rotation.
- **Managing it** (same page): change password (current password + code; sessions that came in with the old one end), new authenticator (needs a code from the current one; the old one works until the new one is confirmed), new recovery codes (needs a code; the old ones stop working), turn it off (needs a code). Another admin can only turn it off for you (Admin → People → row menu), never see or set your password.
- **Only admins.** A member made a player loses it at once: the row is deleted and `User.sessionVersion` is raised, which ends every session they have, Discord ones too. The members' email login (invite-only) is a separate thing and is unchanged.
- **Limits** (`src/server/auth/lockout.ts`, in memory): 5 failures for one username within 15 minutes lock that username for 15 minutes; 20 failures from one address within 15 minutes lock that address for 15 minutes. Only failures count; a success clears the username's count. Locked means refused even with everything right. Unknown usernames count like known ones and spend the same time (a dummy argon2 check). The form says the same for a wrong username, password or code ("That didn't work. Check the username, the password and the code…"); only a lock says so ("Too many attempts. Wait 15 minutes").
- **Sessions from it last 12 hours** (the token carries `until`; checked in the middleware too). Every request that reads the member also checks that a password session's password is still the one it was made with and still switched on.
- **Seen by everyone**: every attempt is in the event log with the address and its country (looked up by `api`, `GET /geo`): "Alex signed in with password + code from 1.2.3.4 (DE)", "Failed admin sign-in for 'alex' from 1.2.3.4 (DE)". Every successful one is shown to every admin at the top of every page for 24 hours (`components/admin-signin-notice.tsx`), until that admin presses the banner's one button: "That was me" when every sign-in listed is their own, "Seen it" otherwise (Alex, 2026-10-07). The press moves that admin's own "seen up to" time (`User.signInNoticeSeenAt`, migration `0031_signin_notice_seen`) to the newest sign-in the banner showed, never backwards and never past now, and is audited as `auth.signInNoticeSeen` with how many sign-ins it covered. It hides nothing from another admin, nothing is acknowledged by itself, and a new password or one-time-link sign-in brings the banner back with only the sign-ins since (`server/auth/signin-notice-core.ts`). No Discord message: there is no bot token (`DISCORD_BOT_TOKEN` unset).
- **Break-glass** when no admin can get in: docs/09 Runbook, `pnpm admin:reset-auth <username>` in the api container.

## Ending sessions

Sessions are signed cookies, so ending one means refusing it: `loadCurrentUser()` (`src/server/auth/session.ts`) checks every session against the database with `sessionProblem()` (`session-check.ts`). Pages, server actions and the admin API routes all go through it. `GET /api/auth/verify` and `/api/auth/verify/admin` (Caddy's `forward_auth` for the map and the mc-router dashboard) go through it as well (docs/35 R-11), with one answer per session kept for 30 seconds: an ended session, or an admin made a player, keeps the map or the dashboard for at most that long.

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
