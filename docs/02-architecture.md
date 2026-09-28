# 02 · Architecture

## Components

```
                  Internet
                     |
               [Caddy :443]  automatic TLS, rate limiting, forward_auth
                /        \
  deepslate.example.com   map.deepslate.example.com
        |                          |
  [web  :3000]  ---forward_auth-->  [bluemap :8100]  (BlueMap webserver inside the MC instance)
   Next.js app                       |
        |                            |
  [postgres :5432]            [AMP  :8080 + MC :25565]
        |                     Minecraft Java instance, NeoForge 1.21.1
  AMP HTTP API  <------------ (app talks to AMP over the docker/host network, never exposed)
```

Everything runs on the one VPS. AMP is installed on the host (or in its own container, whichever is already the case); the web stack runs from `deploy/docker-compose.yml`.

## Stack and why

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 15, App Router, TypeScript strict | One codebase for pages and API, server components keep AMP secrets server-side |
| UI | Tailwind + shadcn/ui | Fast to build, looks fine on phones, easy for another session to extend |
| Auth | Auth.js (next-auth v5) | Discord provider out of the box, credentials provider for the fallback, session cookies, CSRF handled |
| DB | PostgreSQL 16 + Prisma | Small schema, migrations, typed queries |
| Proxy | Caddy 2 | Auto TLS, `forward_auth` lets us put BlueMap behind the app's login with zero code in BlueMap |
| Map | BlueMap (NeoForge server mod) | Live 3D map, player markers, no client mod |
| Server control | AMP HTTP API | Already there; status, console, player list, restarts, file access |
| Modpack tooling | Node CLI in `packages/modpack` | Same language as the app, runs in CI and on the VPS |
| Installer | PowerShell 5.1 script + `.bat` launcher, plus `.mrpack` | PowerShell is on every Windows PC; `.mrpack` covers Mac/Linux via the Modrinth App or Prism |

## Repository layout

```
.
├── the working rules
├── docs/
├── apps/web/                 Next.js app
│   ├── src/app/              routes (see 05-features.md for the page list)
│   ├── src/server/           server-only code
│   │   ├── amp/              AMP client wrappers (typed, timeouts, retries)
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

## AMP integration

- Create an AMP user `webapp` with only: Login, view instance, console access (send + read), player list, start/stop/restart of the one instance. Never the ADS admin account.
- Auth flow: `POST /API/Core/Login {username, password, token:"", rememberMe:false}` → `sessionID`; every call posts JSON with `SESSIONID`. Sessions expire; the wrapper re-logs on `401`/`Unauthorized` once.
- Calls are against the **instance** endpoint (`http://amp:8080/API/...` for the Minecraft instance's port, not ADS), so `Core.GetStatus`, `Core.SendConsoleMessage`, `Core.GetUpdates`, `Core.Start/Stop/Restart`, `MinecraftModule.*` for player lists where available.
- Verify the exact method names and response shapes against the running AMP before writing types: AMP's API is self-documenting at `/API` on the instance. Record what you find in `docs/08-api.md` under "AMP methods used".
- Fallback if AMP console is flaky: enable RCON in `server.properties` and use it for commands only. Keep status on AMP.

## BlueMap behind login

- BlueMap's built-in webserver listens on the instance's port 8100 (configure in `modpack/server/bluemap/webserver.conf`) and is bound to localhost.
- Caddy serves `map.<domain>` with `forward_auth web:3000 { uri /api/auth/verify }`. The app answers 200 for a valid session cookie (shared parent domain cookie), 401 otherwise, and Caddy redirects to `/login?next=`.
- The dashboard embeds the map in an `<iframe>` on the same parent domain, so the session cookie applies.

## Environments

- `dev`: local, `docker compose -f deploy/docker-compose.dev.yml` runs Postgres only; AMP calls hit a mock (`AMP_MOCK=1`) so the app runs without a server.
- `prod`: the VPS. Deploy = `git pull && docker compose up -d --build`. Migrations run on container start.
