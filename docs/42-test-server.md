# 42 · The test server: a second, hidden server with its own copy of the site

Planner, 2026-10-07. Input for the VPS session: file it as written (renumber if 42 is taken, with `42a` beside it), build it in the order of §9, record deviations in `docs/11-status.md`. The AMP host's half is `docs/42a-test-server-amp-host.md`, a task of its own that Alex hands to the AMP host session.

## 1. Why and what it is

Alex, 2026-10-07: a second server, hidden from players, where a whole season can be played through before anybody sees it and it shows in the dashboard.

A season advancement can be earned once per player, so the real Season 1 cannot be tried on the live world without spending it (docs/34 §8 decision 1). The live server is also the wrong place to try a wipe, a new dimension or a new mod's first start.

**The test server is a staging copy of everything, not a second world inside the live one:**

| Part | Live | Test |
|---|---|---|
| Game server | AMP instance `DeepslateWorks01` | A new AMP instance `DeepslateTest01` on the same host |
| World | The permanent world | A fresh world on the live seed, thrown away at will |
| `api` | `deepslate-api` | `deepslate-api-test`, the same image family, pointed at the test instance |
| `web` | `deepslate-web` | `deepslate-web-test` at its own host name |
| Database | `deepslate` | `deepslate_test`, a second database in the same Postgres container |
| Code and pack files | `main`, the live checkout | `dev`, a second checkout |
| Discord | The real channels and the bot | A private test channel by webhook, no bot |
| Who gets in | Members | Admins and whoever Alex adds by name |

**Why a copy of the stack and not one `api` for two servers.** `api` is built around one instance: one AMP client, one console tail, one door, one recorder, one set of season rows. Teaching it a second instance touches the door and the recorder weeks before Season 1 and puts test rows in the live database. A copy changes no live code path, and what is tested is exactly what will run.

**What it gives beyond Season 1:**

- The rehearsal of 23 November (docs/34 §7) moves here and can be run any day, with the real `s1` file instead of the sample.
- The wipe (W1.7) is tried here on a real Frontier instead of a throwaway dimension on the live server.
- docs/36 Step 0 part 2 (the worldgen test packs under NeoForge) runs here, not on the live world.
- `dev` is seen running before a `dev` → `main` PR.
- A new mod's first server start (Aquamirae for Season 2) happens here first.

## 2. Decided by the planner, for Alex to overrule

1. **A copy of the stack** (above).
2. **The test stack runs `dev`**: its own checkout on `dev` and images built from `dev` on request (§5.3). Season work lands on `dev` first and `build seasons` is code inside the `api` image, so `main`'s image cannot build a `dev` season file.
3. **Same mods on PCs.** The test server runs the lock the live server runs, so Alex joins with the game he already has. A test of a different lock needs a second profile in the app and is not in this plan (§10).
4. **Off by default.** The two test containers run only while `TEST_STACK=1` is in `deploy/.env`. The test instance sleeps when empty and does not start with the host.

## 3. Hidden from players

- **The site** is `test.deepslate.dsw.test` (placeholder; the real name goes in `deploy/.env` only). Caddy lets a request through only with a live admin session, the same `forward_auth` to `/api/auth/verify/admin` that guards the mc-router dashboard. A member gets "Admins only", a stranger the live login. Nobody else sees even its sign-in page.
- **Its own sign-in behind that.** The test site has its own users in `deepslate_test`. `ADMIN_DISCORD_ID` makes Alex its first admin; anyone else needs an invite made on the test site. `DISCORD_GUILD_AUTO_JOIN=0` there.
- **The game address** is `lab.dsw.test` (placeholder), one more name on mc-router. The test instance has `white-list=true` and `enforce-whitelist=true`: a name not on the list is refused before the world loads. Its own door still asks for a link, once per tester.
- **Nothing public is written by the test stack:** no bot, no post in game chat or season-updates, no change log, no nightly dump, no S3. The live site's member pages never mention it.
- **In the repo** the plan is public like the rest of Season 1's (Alex, 2026-10-07: hidden from players, fine in the repo). Real names and addresses stay in `deploy/.env`.

## 4. How Alex uses it

1. Control Room on the live site has a **Test server** card: asleep, starting or online, who is on it, the commit and pack it runs, the season loaded. One button opens the test site, one copies the game address.
2. The admin strip on both sites has **Live | Test**, which opens the same page on the other site.
3. The test site is the control panel he knows, with a stripe across the top that reads TEST on every page and in the tab's title. Server, Modpack, Seasons, People and Console work as on live and act on the test instance only.
4. To play a season through: Build and Sync on the test site, set the test clock (§7.1) to opening night, Announce, Start, join `lab.dsw.test`, summon and kill each boss, walk the clock forward a drop at a time, open the finale, see the crate arrive, End, wipe. Then **Reset the season test** (§7.2) and do it again.

## 5. The test stack on the VPS

### 5.1 Compose

Two services in `deploy/docker-compose.yml` under `profiles: [test]`, started and kept by `deploy.sh` only while `TEST_STACK=1` (the designer's pattern):

| Service | Image | Memory limit | Notes |
|---|---|---|---|
| `web-test` (`deepslate-web-test`) | `deepslate-web:${TEST_IMAGE_TAG}` | 512m | `DATABASE_URL` → `deepslate_test`; `AUTH_URL` the test host; its own `AUTH_SECRET`; no `COOKIE_DOMAIN`; `API_URL=http://deepslate-wg:4001`; `TEST_MODE=1` |
| `api-test` (`deepslate-api-test`) | `deepslate-api:${TEST_IMAGE_TAG}` | 384m | `network_mode: service:wireguard`, `PORT=4001`; its own `API_SERVICE_TOKEN`; `AMP_INSTANCE_ID`, `AMP_PASSWORD` and `RSYNC_TARGET` of the test instance; `DEPLOY_KEY_PATH` of the test key; `TEST_MODE=1`; no `DISCORD_BOT_TOKEN` |

- Every mount that is `${DEEPSLATE_DIR}/…` on live is `${TEST_DIR}/…` here (`dist`, `modpack`, `installer`, `data/…`), so a test Build never touches the live `dist/`.
- The variables are a block of their own in `.env.example`, each prefixed `TEST_`, with placeholders. `deploy.sh`'s placeholder check covers them only while `TEST_STACK=1`.
- **Before the first start:** `free -m` and `docker stats --no-stream` on the VPS, written into the status. The box has 7.7 GB for every site on it (docs/09). If less than 1.5 GB is free with the live stack and the designer up, report before starting anything.
- The live `api`'s healthcheck and `deploy.sh`'s health gate do not wait on the test services (the lesson of the designer's first deploy).

### 5.2 Database

`deepslate_test` in the existing `deepslate-db`, owned by the same role, made once by `deploy.sh` when `TEST_STACK=1` and it is missing. `web-test` applies migrations at its start as `web` does. It is not in the nightly dumps. A script `deploy/test-db-reset.sh` drops and remakes it; it refuses any database name but `deepslate_test`.

### 5.3 Code: the checkout and the images

- **Checkout:** `/home/ladm/Minecraft-site-test` on `dev`, read-only for the containers except `dist/` and `data/`. `deploy/test-pull.sh` (as ladm) fast-forwards it to `origin/dev` and prints the commit.
- **Images:** `dev` builds no images (docs/11, the Actions minutes). A workflow `test-images.yml`, run by hand only (`workflow_dispatch`, a ref, default `dev`), builds both images and tags them `test` and the commit. `TEST_IMAGE_TAG=test`. One run when Alex wants new code on the test site, not one per push.
- **The test site says what it runs** in its footer and on the Control Room card: the images' commit, the checkout's commit and a warning when the two differ.

### 5.4 Reaching the instance

- `api-test` shares the WireGuard container, so the tunnel and the ADS on 8080 are the ones in use. The instance is addressed by its own id through the ADS proxy path. No new port in `wg0-acl.nft`.
- **Its own deploy key** (`deploy/keys-test/`): the live key's `rrsync` root is the live instance and stays that way. The test key can write the test instance's `Minecraft/` and nothing else. The AMP host's key is pinned in `known_hosts` as on live.

### 5.5 Caddy

A block in `deploy/Caddyfile.snippet` for the test host: `forward_auth` to the live site's `/api/auth/verify/admin`, the live session cookie stripped before the request reaches `web-test`, the admin's id in the access log, the same body limit as the site. Tried in a throwaway Caddy against mock upstreams first, as the router's block was.

**The cookies.** The live session cookie is set for the parent domain, so the browser sends it to the test host as well. `web-test` therefore names its own session cookie differently (`TEST_MODE` adds a prefix) and must never read the live one. A test: a request carrying only a live cookie is signed out on the test site.

## 6. What `TEST_MODE=1` changes in the code

Small and all in one place each. With `TEST_MODE` unset nothing changes; a test asserts that for each item.

| # | Where | What |
|---|---|---|
| T1 | web | The TEST stripe on every page, "TEST" in the title, the Live or Test switch in the admin strip |
| T2 | web | Its own session cookie name (§5.5) |
| T3 | web | Lock, Apply results and every other `commitManifest` path are refused with "The test site never writes to git". The lock is whatever the checkout has |
| T4 | web, api | Warn on Admin → Modpack when the checkout's lock differs from the pack the live site serves: "Your PC has the live pack. It will not match this server" |
| T5 | modpack, api | `SEASONS_SHIP` (a list of season ids) replaces `index.json`'s `ship` for a Build. Honoured only in `TEST_MODE`, said in the Build's first line. On live the variable is ignored and a test proves it |
| T6 | modpack | `modpack/test-overlay/`: files copied over `dist/server/` at the end of a `TEST_MODE` Build. First contents: BlueMap with no web server and no rendering, Simple Voice Chat on a port nothing forwards |
| T7 | api | The health watch expects no world backup and no database dump and sends nothing to any Discord channel but the test webhook. The dump push to the AMP host is off |
| T8 | api | The door's defaults for a new test database: linking on, Play first off, must-vote off, the newest-app rule off. Alex can turn each on to test it |
| T9 | api | `GET /test/summary` for the live site's card: state, players, commits, pack, season state. Answered only to the live site's own token (`TEST_SUMMARY_TOKEN`), which opens nothing else |

Discord on test: `DISCORD_WEBHOOK_FEED`, `_ADMIN` and `_UPDATES` are three webhooks of one private channel and one private forum that Alex makes, or empty. Slash commands, vote buttons and the role of docs/41 §5.4 need the bot and are not testable here in this plan (§10).

## 7. Season test tools (test site only)

On Admin → Seasons, shown only in `TEST_MODE`, refused by the api otherwise.

### 7.1 The test clock

A season runs on dates: a trial opens on a Friday, the finale's gate at 20:00 on a Saturday. Waiting for them is not testing.

- "Pretend it is" a date and an hour, UK time. The clock runs on from there. "Back to the real time" clears it.
- Everything in `api` that asks the time for a season (the once-a-minute clock, the recorder's "is it open", `week` and `daysLeft`, the finale gate of docs/41 §3) asks one function, and that function is the only place the pretend time lives. The door, sessions, audit rows and logs keep the real time.
- Quick buttons beside it: "To opening night", "To the next drop", "To five minutes before the finale", worked out from the season file.
- The stripe shows the pretend time while one is set.

### 7.2 Reset the season test

One button, behind a confirmation that names the season: takes back every advancement of that season from every player (`advancement revoke … from` its root), clears the tags and scores its datapacks set, deletes that season's `Season`, `SeasonClear` and `SeasonTitle` rows and its marks, clears the test clock. The world, the players' inventories and the datapack stay. So a kill can be made first on the server ten times in an evening.

### 7.3 Not built: a copy of the live world

The test world is fresh ground on the live seed, so spawn, the temple's spot and every boss structure are where they are on live. Bringing the live world's real chunks across (to see the temple against the real spawn buildings) is a later step for the AMP host (§10).

## 8. The live dashboard

- **Control Room card "Test server"** (admins only, absent while `TEST_STACK` is off): from `GET /test/summary` through the live `web`, asked every 20 s while the tab is seen. Off, asleep, starting, online; players on it; the commit and pack; "Season 1 · running, test clock 19 Dec 19:55"; buttons "Open the test site" and "Copy the address". When the summary cannot be reached the card says so and nothing else on the page waits for it.
- **Live | Test** in the admin strip of both sites: the same path on the other host.
- Nothing about it in any member's page, the app, `/api/modpack/manifest` or `/api/health`'s public half.

## 9. Order of work

| # | Who | What | Size |
|---|---|---|---|
| S0 | VPS, AMP host | The two memory checks (§5.1 here, §1 of 42a). Report both before anything is made | S |
| S1 | AMP host | The instance, its key line, the route (docs/42a) | M |
| S2 | Alex | The `webapp` user on the new instance, two DNS names, the Discord app's second redirect address, a private Discord channel and forum for test, the `TEST_` block in `deploy/.env` | S |
| S3 | VPS | Compose profile, the database, the checkout, `test-pull.sh`, `test-images.yml`, the test key, the Caddy block (§5) | M |
| S4 | VPS | `TEST_MODE` T1 to T9 (§6) | M |
| S5 | VPS | The Control Room card and the switch (§8) | S |
| S6 | VPS | The test clock and Reset (§7) | M |
| S7 | Alex, with the VPS session reading the logs | Season 1 played through on the test server, docs/34 §7's list and docs/41 §9's | |

S3 and S4 go to `main` together in one PR: the profile is inert without `TEST_STACK=1`. S6 depends on docs/41's finale gate for its last button and can ship without it.

## 10. Not in this plan

- A different lock on test (a second profile in the app).
- The bot on test (a second Discord application and a test Discord server).
- A copy of the live world's chunks.
- The app's season banner against the test site.
- BlueMap for the test world.

## 11. Done when

- [ ] With `TEST_STACK` unset, `docker compose config` and a deploy are what they were and every `TEST_MODE` test passes its "unset changes nothing" half.
- [ ] The test host: signed out → the live login; a member → "Admins only"; an admin → the test site's own sign-in; a live cookie alone signs nobody in on test.
- [ ] A Build on the test site writes only under the test checkout's `dist/`; a Sync changes only the test instance (the live instance's `mods/` listing is the same before and after).
- [ ] `SEASONS_SHIP=s1` on test builds `deepslate-season-s1`; the same variable on live builds nothing and says so.
- [ ] A name not on the whitelist is refused at `lab.dsw.test`. A whitelisted, linked admin gets in and the live server shows nobody new.
- [ ] A boss killed on test makes a row in `deepslate_test`, a line on the test `/season` and a message in the test channel. The live database, the live `/season` and the real Discord channels show nothing.
- [ ] The test clock set to five minutes before the finale opens the gate five minutes later; "Back to the real time" closes it.
- [ ] Reset, then the same kill again: first on the server again.
- [ ] The Control Room card shows the test server asleep, then online with Alex on it, then "off" after `TEST_STACK` is removed and a deploy.
- [ ] The VPS with both stacks up and a test Build running has not gone into swap beyond what it used before (numbers in the status).

## 12. Open, for Alex

1. **Memory on the AMP host.** It has 15.5 GB and the live server may take 10 GB of heap (docs/33 §3). A test server with 4 GB beside it is too tight when both are busy. Recommended: raise the VM to 24 GB if the Proxmox host has it. Otherwise the test server is used while the live one sleeps or with 3 GB.
2. **The two names**, real ones in `deploy/.env`: the test site (it must sit under the live site's domain for the admin gate to work) and the game address (anything that does not say "test" or "season").
3. **Actions minutes.** Each press of `test-images.yml` costs about what one push to `main` costs. If the month's budget is tight, the test stack can run `main`'s images until a season change needs `dev`.
4. **Who else tests.** The plan assumes admins. A second player is needed for the 48-block group credit; that is one invite on the test site and one whitelist line.
