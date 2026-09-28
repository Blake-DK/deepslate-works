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
    [postgres :5432] (internal)
```

Everything on the VPS runs from `deploy/docker-compose.yml` and joins the existing `web` proxy network (Caddy) plus a private `internal` network. Players never touch the VPS for game traffic: Minecraft and voice chat go through Pangolin on the homelab, which this project does not configure.

**Security boundary.** `web` is internet-facing and has no route to the homelab and no AMP credentials. `api` is the only code that talks to AMP, BlueMap or rsync; it runs inside the WireGuard container's network namespace (`network_mode: service:wireguard`), which is on `internal` only, so `api:4000` is reachable from `web` (bearer service token) and nothing on the `web` network. The map is relayed in two hops (`map-relay-inner` in the tunnel namespace → `map-relay-outer` on `web`+`internal`) so the tunnel namespace never joins `web`. See docs/13 §3.

## Stack and why

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 15, App Router, TypeScript strict | One codebase for pages and API, server components keep AMP secrets server-side |
| UI | Tailwind + shadcn/ui | Fast to build, looks fine on phones, easy for another session to extend |
| Auth | Auth.js (next-auth v5) in `web`; random service token between `web` and `api` | Discord provider out of the box, credentials provider for the fallback, session cookies, CSRF handled; `api` re-checks role, username and rate limits itself |
| Backend | Fastify 5 + TypeScript in `apps/api` | Only code with a route to the homelab: AMP client, status poller, action registry, rsync sync |
| Tunnel | WireGuard (linuxserver image) confined to Docker | VPS host has no route to the homelab; UDP 51820 is the only extra host port |
| DB | PostgreSQL 16 + Prisma | Small schema, migrations, typed queries |
| Proxy | Caddy 2 | Auto TLS, `forward_auth` lets us put BlueMap behind the app's login with zero code in BlueMap |
| Map | BlueMap (NeoForge server mod) | Live 3D map, player markers, no client mod |
| Server control | AMP HTTP API via the ADS instance proxy | Instances bind their API to localhost on the AMP host; the ADS on 8080 proxies `/API/ADSModule/Servers/<id>/API/...` |
| Modpack tooling | Node CLI in `packages/modpack` | Same language as the app, runs in CI and on the VPS |
| Installer | PowerShell 5.1 script + `.bat` launcher, plus `.mrpack` | PowerShell is on every Windows PC; `.mrpack` covers Mac/Linux via the Modrinth App or Prism |

## Repository layout

```
.
├── the working rules
├── docs/
├── apps/api/                 Fastify backend (tunnel namespace): amp/, poller/, actions/, modpack/sync.ts
├── apps/web/                 Next.js app (frontend + auth)
│   ├── src/app/              routes (see 05-features.md for the page list)
│   ├── src/server/           server-only code
│   │   ├── api-client.ts     thin bearer-token client for apps/api (no AMP code here)
│   │   ├── actions/          named server actions players/admins can run
│   │   ├── modpack/          reads mods.lock.json, serves manifest
│   │   └── auth/
│   └── prisma/
├── packages/modpack/         CLI: lock, build client, build server, sync
├── modpack/
│   ├── mods.json             source of truth (hand-edited)
│   ├── mods.lock.json        generated: exact Modrinth version ids + file URLs + sha512
│   ├── config/               config overrides shipped to client and server
│   └── server/               server-only files (server.properties template, BlueMap config)
├── installer/
│   ├── Setup.bat
│   ├── install.ps1
│   └── README.md
└── deploy/
    ├── docker-compose.yml
    ├── Caddyfile
    └── .env.example
```

## Data flow

**Manifest → everything**
1. Admin edits `modpack/mods.json` (or toggles a mod in the admin UI, which writes the same file and commits it).
2. `pnpm modpack lock` resolves every slug to an exact Modrinth version for NeoForge 1.21.1, follows required dependencies, writes `mods.lock.json` with file URLs and hashes.
3. `pnpm modpack build` produces `dist/client.mrpack`, `dist/server/mods/`, `dist/installer.zip` (the installer with the manifest URL baked in).
4. `pnpm modpack sync-server` copies `dist/server/mods` and `modpack/server/*` into the AMP instance's directory (host path from `.env`), then asks AMP to restart if the mod set changed.
5. The app serves `GET /api/modpack/manifest` (from the lockfile) for the installer, and `GET /install` for humans.

**Server state → app**
- `src/server/amp/` polls the instance every 15 s (`GetStatus`: state, players, CPU, RAM, TPS from the console tail) and caches in memory; pages read the cache. No AMP call in a request path except explicit actions.
- Console output is tailed via `GetUpdates` for chat, joins/leaves and command results.

**Player action → server**
- Player clicks "Add me to the whitelist" → server action `whitelist.addSelf` → permission check → builds `whitelist add <mcUsername>` → `SendConsoleMessage` → waits for the matching console line or 5 s → writes an `AuditLog` row → returns result.

## AMP integration (docs/13 §4)

- AMP lives on the homelab; every instance binds its API to `127.0.0.1`, only the ADS listens on `0.0.0.0:8080`. We therefore talk to the **ADS** at `AMP_URL=http://10.77.0.2:8080` and address the instance through the proxy path `/API/ADSModule/Servers/<AMP_INSTANCE_ID>/API/<Module>/<Method>` with the same JSON body and `SESSIONID` as a direct call. Login is `POST /API/Core/Login` against the ADS.
- `webapp` is an ADS-level user with rights only on the `DeepslateWorks01` instance: login, console read/write, player list, start/stop/restart, file manager read. Never the ADS admin account.
- The wrapper (`apps/api/src/amp/`) re-logs once on `401`/`Unauthorized`, times out at 10 s, and has a mock (`AMP_MOCK=1`) so everything runs before the instance exists.
- Verify method names and response shapes against the ADS's `/API` listing once the tunnel is up; record them in docs/08 "AMP methods used".
- `sync-server` = rsync over SSH through the tunnel from `api` to `amp@10.77.0.2` (rrsync rooted at the instance's `Minecraft/` dir, deploy key mounted read-only at `/run/keys/deploy.key`), then `Core.Restart` through the proxy if `mods/` changed. No bind mount.

## BlueMap behind login

- BlueMap on the AMP host listens on `10.77.0.2:8100` (tunnel address only).
- Caddy serves `map.deepslate.dsw.test` with `forward_auth deepslate-web:3000 { uri /api/auth/verify }` and proxies to `deepslate-map-relay-outer:8100`, which forwards to the tunnel namespace, which forwards to BlueMap. 401 → redirect to the portal login with `next`.
- The session cookie is scoped to `.deepslate.dsw.test`, so the dashboard iframe and the map host share it.

## Environments

- `dev`: local, `docker compose -f deploy/docker-compose.dev.yml` runs Postgres only; AMP calls hit a mock (`AMP_MOCK=1`) so the app runs without a server.
- `prod`: the VPS. Deploy = `cd /home/ladm/Minecraft-site && docker compose -f deploy/docker-compose.yml up -d --build`. Migrations run on `web` start. Recreating `wireguard` recreates `api` and `map-relay-inner` (shared namespace).
