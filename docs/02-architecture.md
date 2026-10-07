# 02 · Architecture

## Components

```
                       Internet                                  Alex's homelab
                          |                                            |
                    [Caddy :443]  (existing web-proxy stack)     [AMP host]  ADS :8080 (all instances proxied through it)
                    /            \                                    |   BlueMap :8100 (bound to 10.77.0.2)
   deepslate.dsw.test     map.deepslate.dsw.test                     |   sshd :22 (rrsync-restricted deploy key)
          |                        | forward_auth web                 |
    [web :3000] (web+internal)   [map-relay-outer :8100] (web+internal)
    Next.js, Auth.js, pages        |                                  |
          | bearer token           v                                  |
          v                   [deepslate-wg :8100]  <-- map-relay-inner, in the tunnel namespace
    [deepslate-wg :4000] = [api] Fastify, in the tunnel namespace ----+  WireGuard 10.77.0.1 <-> 10.77.0.2 (udp 51820, homelab initiates)
          |
    [postgres :5432] (internal)  <-- [backups] pg_dump every night, seven kept
```

Everything on the VPS runs from `deploy/docker-compose.yml` and joins the existing `web` proxy network (Caddy) plus a private `internal` network. Players never touch the VPS for game traffic: Minecraft and voice chat go to the homelab's own address, where mc-router hands `mc.dsw.test` to the instance (docs/17). This project configures neither that nor Pangolin, which used to carry it.

| Container | Image | Memory | What it holds |
|---|---|---|---|
| `deepslate-web` | `ghcr.io/<owner>/deepslate-web` (built by CI) | 768 MB | the site. Mounts `modpack/` and `.git` (the admin UI edits and commits the mod list), `dist/` read-only (what `/downloads` serves), `data/` (uploaded pictures: branding, news) |
| `deepslate-api` | `ghcr.io/<owner>/deepslate-api` (built by CI) | 512 MB, which is also the cap for a modpack build | everything that talks to the homelab. Mounts the deploy key read-only, `dist/` (it builds into it), `modpack/` and `installer/` read-only, the GeoIP database read-only |
| `deepslate-wg` | linuxserver/wireguard | 128 MB | the tunnel; `api` and `map-relay-inner` live in its network namespace. UDP 51820 is the one port the stack opens on the host |
| `deepslate-map-relay-inner`, `-outer` | alpine/socat | 32 MB each | the map, in two hops |
| `deepslate-db` | postgres:16-alpine | 256 MB | data in `/root/docker/deepslate/postgres` |
| `deepslate-backups` | postgres:16-alpine | 64 MB | dumps in `/root/docker/deepslate/backups` |

The images are built by GitHub Actions and pulled; **the VPS never builds** (docs/09). Dockhand shows the stack from a mirror that `deploy/deploy.sh` refreshes; the repo is what counts.

**Security boundary.** `web` is internet-facing and has no route to the homelab and no AMP credentials. `api` is the only code that talks to AMP, BlueMap or rsync; it runs inside the WireGuard container's network namespace (`network_mode: service:wireguard`), which is on `internal` only, so `api:4000` is reachable from `web` (bearer service token) and nothing on the `web` network. The map is relayed in two hops (`map-relay-inner` in the tunnel namespace → `map-relay-outer` on `web`+`internal`) so the tunnel namespace never joins `web`. The mc-router dashboard is read by `api` only (below). See docs/13 §3.

## Stack and why

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 15, App Router, TypeScript strict | One codebase for pages and API, server components keep AMP secrets server-side |
| UI | Tailwind 4, with a handful of hand-written parts in the manner of shadcn/ui (`src/components/ui/`) | Fast to build, looks fine on phones, easy for another session to extend; shadcn's own generator was not needed |
| Auth | Auth.js (next-auth v5) in `web`; random service token between `web` and `api` | Discord provider out of the box, credentials provider for the fallback, session cookies, CSRF handled; `web` tells `api` who is asking (`x-user-id`, `x-user-role`) and `api` checks the role for every route |
| Backend | Fastify 5 + TypeScript in `apps/api` | Only code with a route to the homelab: AMP client, console tail, status poller, the entrance room, action registry, pre-generation and map render, file browser, modpack build and rsync sync |
| Tunnel | WireGuard (linuxserver image) confined to Docker | VPS host has no route to the homelab; UDP 51820 is the only extra host port |
| DB | PostgreSQL 16 + Prisma | Small schema, migrations, typed queries |
| Proxy | Caddy 2 | Auto TLS, `forward_auth` lets us put BlueMap behind the app's login with zero code in BlueMap |
| Map | BlueMap (NeoForge server mod) | Live 3D map, player markers, no client mod |
| Server control | AMP HTTP API via the ADS instance proxy | Instances bind their API to localhost on the AMP host; the ADS on 8080 proxies `/API/ADSModule/Servers/<id>/API/...` |
| Modpack tooling | Node CLI in `packages/modpack` | Same language as the app; the site and `api` import it as a library, CI tests it |
| Installer | PowerShell 5.1 script + `.bat` launcher | PowerShell is on every Windows PC. Windows only since 2026-09-29: no `.mrpack` |
| Build and deploy | GitHub Actions → GHCR → `deploy/deploy.sh` | The VPS ran out of memory building images (2026-09-29) and only pulls since |

## Repository layout

```
.
├── the working rules, README.md, ROADMAP.md
├── docs/
├── .github/workflows/ci.yml  lint, typecheck, test; then the two images to GHCR
├── apps/api/                 Fastify backend (tunnel namespace)
│   └── src/
│       ├── amp/              the AMP client and the console tail
│       ├── actions/          the registry of console commands, and the one function that sends them
│       ├── events/           reading the console (every pattern is in parse.ts), sessions, the event log, retention
│       ├── players/          the entrance room, the door, the pack a join is held against
│       ├── status/           poller, pings, planned restarts, pre-generation, map render, who is on
│       ├── files/            the read-only file browser
│       ├── modpack/          build (as a child process) and sync (rsync over the tunnel)
│       ├── routes/           one file for each group of routes
│       └── shared/           byte for byte the same as apps/web/src/shared/
├── apps/web/                 Next.js app (pages, sign-in, the database)
│   ├── src/app/              pages and routes (05-features.md has the pages, 08-api.md the routes)
│   ├── src/server/           server-only code: api-client.ts (the only way to `api`), auth/, modpack/, vote/, events, settings …
│   ├── src/lib/              pure functions, tested
│   ├── src/shared/           what `api` needs too: events, settings, the door's rules
│   ├── src/components/
│   └── prisma/               schema and migrations (`apps/api/prisma/schema.prisma` is a link to the same file)
├── packages/modpack/         lint, verify-links, lock, build
├── modpack/
│   ├── mods.json             source of truth (edited by hand or by the admin UI)
│   ├── mods.lock.json        generated: exact Modrinth versions, addresses, checksums; the settings files' checksums
│   ├── config/               settings shipped to every PC and to the server
│   ├── server/               server-only files (BlueMap's settings)
│   └── datapacks/            the entrance room's dimension (`deepslate-limbo`)
├── installer/                Setup.bat, "Update and Play.bat", install.ps1, README.txt
├── dist/                     what a build makes (not in git): server/, config.zip, installer.zip, installer.json
├── data/                     uploaded pictures and screenshots (not in git)
└── deploy/
    ├── docker-compose.yml
    ├── deploy.sh             pull and start; the only way to deploy
    ├── check.sh              typecheck, lint and tests in a container with a memory cap
    ├── dockhand-sync.py      refreshes Dockhand's mirror of the stack
    ├── Caddyfile.snippet     the two blocks as they are in the shared Caddyfile
    ├── .env.example
    ├── keys/, wireguard/     secrets (not in git)
    └── README.md
```

## Data flow

**Manifest → everything**
1. Admin edits `modpack/mods.json` (or toggles a mod in the admin UI, which writes the same file and commits it).
2. **Lock** resolves every slug to an exact Modrinth version for NeoForge 1.21.1, follows required dependencies, takes the checksums of the settings files, and writes `mods.lock.json`. The pack's version is `<version>+<first eight of the lock's hash>`.
3. **Build** (inside `api`, under its memory cap) produces `dist/server/` (mods, settings, datapacks), `dist/config.zip`, `dist/installer.zip` (the installer with the site's address and the pack's version stamped in) and `dist/installer.json` (its version and checksum).
4. **Sync** (inside `api`) copies `dist/server/` to the instance by rsync over the tunnel and asks AMP to restart if the set of mods changed. Settings alone do not restart it.
5. The site serves `GET /api/modpack/manifest` (from the lockfile) and `/downloads/installer.zip`, `/downloads/config.zip` to members who may download, and writes each into the download log.

**Server state → app**
- `apps/api/src/status/poller.ts` asks AMP every 10 s (`GetStatus`: state, players, CPU, memory, TPS) and keeps the answer in memory; pages read that. A `ServerSnapshot` is written every 15 s while the server runs and every five minutes while it does not.
- The console is tailed through `GetUpdates` (every 2 s while the server runs, 15 s otherwise) for joins, leaves, chat, deaths, advancements, and the answers to the few commands the portal sends by itself: pings (spark), positions at the door, chunky, BlueMap, `list`.

**Portal → server**
- Every console command is an entry in `apps/api/src/actions/registry.ts`: a name, a role, a checked input, and a function from that input to fixed words. Nothing a person types becomes part of a command except through those checks. What was sent, by whom and with what result is an `Event`.
- A newcomer's way in (docs/14) is the largest user of it: hold in the room, remind, release on the link.

## AMP integration (docs/13 §4)

- AMP lives on the homelab; every instance binds its API to `127.0.0.1`, only the ADS listens on `0.0.0.0:8080`. We therefore talk to the **ADS** at `AMP_URL=http://10.77.0.2:8080` and address the instance through the proxy path `/API/ADSModule/Servers/<AMP_INSTANCE_ID>/API/<Module>/<Method>` with the same JSON body as a direct call, the session in an `Authorization: Bearer` header (not `SESSIONID` in the body, deprecated in AMP 2.8). Login is `POST /API/Core/Login` against the ADS.
- `webapp` is a user of the instance `DeepslateWorks01` and of nothing else (the instance is unmanaged and has users of its own, docs/13 §10): console read and write, start, stop, restart, file manager read, taking and listing backups, and one setting, sleep mode. Never an admin account.
- The wrapper (`apps/api/src/amp/`) re-logs once on `401`/`Unauthorized`, times out at 10 s, and has a mock (`AMP_MOCK=1`) so everything runs before the instance exists.
- The methods in use, as the instance answers them, are in docs/08 "AMP methods used".
- AMP fixes a session's permissions at login, replays the last forty console lines to every new session, and after a restart of ADS answers an old session with HTTP 200 and "requires the Session.Exists permission". The client knows all three.
- Sync = rsync over SSH through the tunnel from `api` to `amp@10.77.0.2` (rrsync rooted at the instance's `Minecraft/` dir, deploy key mounted read-only at `/run/keys/deploy.key`), then `Core.Restart` through the proxy if `mods/` changed. No bind mount.

## BlueMap behind login

- BlueMap on the AMP host listens on `10.77.0.2:8100` (tunnel address only).
- Caddy serves `map.deepslate.dsw.test` with `forward_auth deepslate-web:3000 { uri /api/auth/verify }` and proxies to `deepslate-map-relay-outer:8100`, which forwards to the tunnel namespace, which forwards to BlueMap. 401 → redirect to the portal login with `next`.
- The session cookie is scoped to `.deepslate.dsw.test`, so the dashboard iframe and the map host share it.

## mc-router on Admin → Server → Router (Alex, 2026-10-07)

- The AMP host runs a small dashboard for mc-router (routes, who is connecting, free ports; docs/17) on `10.77.0.2:8090`. It has no login of its own, shows players' addresses, and its `POST`/`DELETE` calls add and remove live game routes.
- `api` is the only thing that talks to it, over the tunnel (`ROUTER_DASH_URL`, `apps/api/src/router/client.ts`, 8 s timeout): `GET /router`, `POST /router/routes`, `DELETE /router/routes/:hostname` (docs/08), admins only on every request, the two changes in the event log as "Alex added the game address …" / "removed …". The address players join by (`SERVER_ADDRESS`) is never removed from the site. Only the overview, the last 20 logins and the route calls are used; the dashboard's `/hook`, DNS and AMP-start calls are not.
- **Where sessions came from.** Behind mc-router the game server only sees a local address, so no game session had an address or a country before 2026-10-07. Every 2 minutes `api` matches sessions of the last `ipDays` that have none to mc-router's login of the same player (UUID, else name) on the `SERVER_ADDRESS` route, at most 5 minutes before the join (`apps/api/src/router/addresses.ts`), and keeps the address and its country like any other (privacy `geo`, retention `ipDays`, docs/16). Sessions from before the dashboard (2026-10-07) and joins on the LAN stay without a country. The Countries card on the analytics page and the countries on a player's page are for admins (and the player themselves) only.
- `web` shows it on Admin → Server → Router (`app/(app)/admin/server/router.tsx`), refreshed every 15 s like the other tabs. Nothing in the browser talks to the AMP host.
- First built as its own host behind Caddy with two relays (`router.deepslate.dsw.test`, `/api/auth/verify/admin`), taken out the same day: the outer relay sat on the shared `web` network, where any other site's container could open the dashboard without passing Caddy's admin check.
- The AMP host's `wg0` nftables (`/etc/wireguard/wg0-acl.nft`) let `10.77.0.1` in on tcp 8090 since 2026-10-07; the dashboard's own table (`inet mc_dash`) allows the same.

## Environments

- `dev`: a machine with Node. `pnpm dev` with a Postgres of one's own; AMP calls hit a mock (`AMP_MOCK=1`) so the app runs without a server. There is no compose file for it.
- `prod`: the VPS, which has no Node. Deploy = push to `main`, wait for CI, `sudo deploy/deploy.sh` (docs/09). Migrations run when `web` starts. Recreating `wireguard` recreates `api` and `map-relay-inner` (shared namespace). Checks before a push: `deploy/check.sh`.
