# 12 · Planner update · 2026-09-28 (evening)

From the planning session, for the VPS build session. Read `docs/11-status.md` first; this file answers its open questions, overrides parts of docs 02/04/06/09/10, and sets the next steps. Apply the doc edits in §6 as your first commit, then carry on.

## 1. Decisions (final unless Alex says otherwise)

| Topic | Decision |
|---|---|
| Portal domain | *(superseded by docs/13 §1: stays `deepslate.dsw.test`, map `map.deepslate.dsw.test`, cookie `.deepslate.dsw.test`)* ~~**`portal.dsw.test`** (replaces the `deepslate.dsw.test` placeholder). Map: **`map.dsw.test`**. `COOKIE_DOMAIN=.dsw.test` from now, so the same session covers both hosts. Discord redirect URL: `https://portal.dsw.test/api/auth/callback/discord`. |
| VPS ↔ AMP link | **WireGuard confined to Docker**, not Tailscale. A `wireguard` container on the VPS owns the tunnel; only containers that share its network namespace can reach the homelab. The VPS host itself gets no route. Details in §3. |
| Player traffic | Untouched. Players reach Minecraft and voice chat through **Pangolin** (`pangolin-01v`), which stays out of bounds for this project. |
| Frontend / backend split | Keep the existing Next.js app as the **frontend + auth layer** (`deepslate-web`). Add a **backend** service (`deepslate-api`, Fastify + TypeScript) that runs inside the `wireguard` namespace and is the only code that talks to AMP, BlueMap or rsync. `deepslate-web` holds no AMP credentials and has no route to the homelab. Details in §4. This is deliberately not the full Vite SPA + Fastify rewrite floated earlier; it gets the same security property without discarding Phase 0. |
| Caddy | The existing `web-proxy` stack, as you already did. Rate limiting stays in the app. |
| Discord fallback | Keep the email/password provider until Alex confirms everyone has Discord. |
| Repo location | `/home/ladm/Minecraft-site` as it is. |

## 2. Answers to `11-status.md` open questions

1. *(superseded by docs/13 §4: talk to the ADS on 10.77.0.2:8080 via the instance proxy path, `AMP_INSTANCE_ID`)* **AMP host**: reached at **`10.77.0.2`** over the WireGuard tunnel (VPS side is `10.77.0.1`). The Minecraft **instance API port**, the instance directory and the `webapp` user are being produced by a separate tooling session running on the AMP host from `docs/setup-wireguard-amp-host.md`; its report will give you the port and paths, and Alex will paste the AMP `webapp` password into `deploy/.env`. Until then set `AMP_MOCK=1` and keep building. Do not probe the tunnel for ports; wait for the report.
2. **Discord OAuth app**: Alex to create (checklist in §7). Nothing for you to do until the id and secret arrive.
3. **Domain**: `portal.dsw.test` / `map.dsw.test`. Re-issue the bootstrap invite on the new host.
4. **Credentials provider**: keep for now.
5. **World settings**: come from the vote (Phase 1). Defaults if the vote is silent: Normal difficulty, Corpse keeps items (keepInventory off), PvP off.

Also: VPS public IP is `198.51.100.20`; home public IP is `203.0.113.10` (dynamic unless Alex says otherwise). VPS firewall should allow inbound **UDP 51820** (from the home IP if static, otherwise from any; WireGuard drops unauthenticated packets), 80/443, and SSH from the home IP. Remove any broad "all traffic from home" rule.

## 3. WireGuard on the VPS

> Superseded by docs/13 §3 (tunnel namespace is not on `web`; two-hop map relay).

Add to `deploy/docker-compose.yml`:

```yaml
services:
  wireguard:
    image: lscr.io/linuxserver/wireguard:latest
    container_name: deepslate-wg
    cap_add: [NET_ADMIN]
    sysctls: { net.ipv4.conf.all.src_valid_mark: 1 }
    volumes: [./wireguard:/config]          # wg_confs/wg0.conf, git-ignored
    ports: ["51820:51820/udp"]              # only host-level exposure for this path
    networks: [internal, web]               # web = the existing external proxy network, so Caddy can reach map-relay
    healthcheck:
      test: ["CMD", "ping", "-c1", "-W2", "10.77.0.2"]
      interval: 30s
      timeout: 5s
      retries: 3
    restart: unless-stopped

  api:
    build: { context: .., dockerfile: apps/api/Dockerfile }
    container_name: deepslate-api
    network_mode: "service:wireguard"       # shares the tunnel namespace; reachable as deepslate-wg:4000
    env_file: .env
    depends_on: [wireguard, postgres]
    restart: unless-stopped

  map-relay:                                 # lets Caddy reach BlueMap on the AMP host through the tunnel
    image: alpine/socat:latest
    container_name: deepslate-map-relay
    network_mode: "service:wireguard"
    command: TCP-LISTEN:8100,fork,reuseaddr TCP:10.77.0.2:8100
    depends_on: [wireguard]
    restart: unless-stopped
```

`deploy/wireguard/wg_confs/wg0.conf` (git-ignored; template in `deploy/wireguard/wg0.conf.example`):

```
[Interface]
Address = 10.77.0.1/24
ListenPort = 51820
PrivateKey = <vps private key>

[Peer]
# AMP host (homelab). It initiates; no Endpoint here.
PublicKey = <amp-host public key, from the AMP host session's report>
AllowedIPs = 10.77.0.2/32
```

Generate the VPS keys with `wg genkey | tee privatekey | wg pubkey > publickey` inside the container or on the host (`apt install wireguard-tools`), never commit them, and give Alex the **public** key to pass to the AMP host session. `web` must **not** be given a route to `10.77.0.0/24`; it reaches AMP only by calling `api`.

Recreating `wireguard` requires recreating `api` and `map-relay` (shared namespace): always `docker compose up -d` the trio.

## 4. Backend service (`apps/api`)

**Purpose**: everything that touches the homelab. Nothing else.

- Fastify 5 + TypeScript strict, Zod on every input, same pnpm workspace, same Prisma client (needs the DB for `AuditLog` and `ServerSnapshot` only).
- Listens on `0.0.0.0:4000` inside the wireguard namespace. No published port.
- **Auth between web and api**: every request from `web` carries `Authorization: Bearer <API_SERVICE_TOKEN>` (random 256-bit, in `.env` of both) plus `X-User-Id`, `X-User-Role`, `X-Mc-Username` headers set by `web` from the verified session. `api` rejects anything without a valid token. `api` re-validates `mcUsername` against `^[A-Za-z0-9_]{3,16}$` and applies the action registry's own rate limits and permission checks; it does not trust `web` for those.
- **Owns**: `src/amp/` (AMP client: login, re-login on 401, `GetStatus`, `GetUpdates`, `SendConsoleMessage`, `Start/Stop/Restart`, file reads), `src/poller/` (15 s status poll → in-memory cache + `ServerSnapshot`), `src/actions/registry.ts` (the named actions from docs/08), `src/modpack/sync.ts` (rsync over SSH through the tunnel; deploy key mounted read-only from `deploy/keys/`), `src/health.ts`.
- **Routes** (all bearer-protected, mirrored by `web` under `/api/*` for the browser):
  - `GET /status`, `GET /history?hours=`
  - `POST /actions/:name` `{input}` → `{ok, detail}` or `{error}`
  - `POST /server/start|stop|restart` `{delayMinutes?}` (admin role header required)
  - `GET /console/tail?lines=200` and `GET /console/stream` (SSE) (admin)
  - `POST /modpack/sync` (admin, SSE progress)
  - `GET /stats/:uuid` (Phase 4)
  - `GET /health` → `{amp, tunnel, rsync}`
- `deepslate-web` keeps: pages, Auth.js, invites, users, votes, ballots, catalogue, manifest serving, `/api/auth/verify`, `/api/health` (which now also calls `api` `/health`). Its `src/server/amp/` folder goes away; a thin `src/server/api-client.ts` replaces it.
- Move the `SendConsoleMessage` grep rule in docs/10 Phase 4 to: "no `SendConsoleMessage` outside `apps/api/src/actions/`".

Why not the full SPA rewrite: Phase 0 is working, Auth.js is doing real work, and the security goal (internet-facing code cannot reach the homelab or hold AMP credentials) is met by this split. If Alex later wants the frontend to be static, the `api` boundary makes that a frontend-only change.

## 5. Caddy blocks (replace the `deepslate.dsw.test` block)

> Superseded by docs/13 §3 (no re-domain, blocks `import common`).

```
portal.dsw.test {
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=31536000"
    X-Content-Type-Options nosniff
    X-Frame-Options SAMEORIGIN
    Referrer-Policy strict-origin-when-cross-origin
  }
  reverse_proxy deepslate-web:3000
}

map.dsw.test {
  forward_auth deepslate-web:3000 {
    uri /api/auth/verify
  }
  reverse_proxy deepslate-wg:8100       # map-relay → BlueMap on the AMP host over the tunnel
  handle_errors {
    @unauth expression {http.error.status_code} == 401
    redir @unauth https://portal.dsw.test/login?next=https://map.dsw.test{uri}
  }
}
```

The `map.dsw.test` block can go in now; it 502s harmlessly until BlueMap exists (Phase 3).

## 6. Doc edits to make (one commit, `docs: apply planner update 12`)

- **00-overview**: "The server itself runs on AMP **on Alex's homelab**; the portal runs on the VPS. Players reach the game through Pangolin; the portal reaches AMP through a WireGuard tunnel confined to Docker."
- **02-architecture**: replace the component diagram and "AMP integration" / "BlueMap behind login" sections with §3, §4, §5 of this file. Repo layout gains `apps/api/`. Stack table: add the `api` row, change Auth row to "Auth.js in `web`; service token between `web` and `api`".
- **04-auth**: `Domain=.dsw.test`; invite link `https://portal.dsw.test/join/<code>`; note the web→api service token under "Sessions".
- **06-modpack**: `server_address` = whatever Pangolin publishes (ask Alex; placeholder `mc.dsw.test`). `sync-server` = rsync over SSH from `api` to `amp@10.77.0.2` (rrsync-restricted key), not a bind mount. `verify-links` and `lint` unchanged.
- **08-api**: registry path `apps/api/src/actions/registry.ts`; add the web→api route mirror note from §4.
- **09-ops**: VPS layout as in 11-status (`/home/ladm/Minecraft-site`), compose services `web, api, wireguard, map-relay, postgres, backups`; Caddy from §5; `.env` gains `API_SERVICE_TOKEN`, `AMP_URL=http://10.77.0.2:<instance port>`, `MAP_URL=https://map.dsw.test`, `COOKIE_DOMAIN=.dsw.test`, `AMP_TUNNEL_IP=10.77.0.2`, `RSYNC_TARGET=amp@10.77.0.2:`; drop `AMP_INSTANCE_DIR`. Security checklist: VPS firewall = 80/443, UDP 51820, SSH from home IP; keys in `deploy/wireguard/` and `deploy/keys/`, both git-ignored.
- **10-roadmap**: mark open questions 1, 2 answered (this file), keep 3 pending the AMP host report, 4 answered (defaults above), 5 pending. Phase 0 "Build" list: add "`apps/api` skeleton with `/health` and the service-token middleware, wired into compose". Phase 0 "Done when": add "`/api/health` reports `tunnel: ok` once the AMP host side is up". Phase 4 grep rule as in §4.
- **11-status**: update "Where things are" (domain, new containers), deviations 3 and 4 (resolved), and the session log.

## 7. What Alex does (blocking items, in order)

1. Create the Discord OAuth app at discord.com/developers: redirect `https://portal.dsw.test/api/auth/callback/discord`, scope `identify`. Put `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `ADMIN_DISCORD_ID` in `deploy/.env`.
2. DNS: `portal.dsw.test` and `map.dsw.test` → `198.51.100.20` (the wildcard may already cover it; confirm).
3. VPS firewall: UDP 51820 in, SSH from `203.0.113.10`, remove the broad home-IP rule.
4. Run `docs/setup-wireguard-amp-host.md` in a tooling session on the AMP host. Hand its report (AMP host public key, instance API port, instance dir, rrsync path) to this session; hand this session's VPS public key to that one.
5. In AMP: create the `webapp` user with rights on the one instance only (login, console read/write, player list, start/stop/restart, file read on the instance dir). Put the password in `deploy/.env`.
6. Click through Phase 0 acceptance (Discord login → admin page, invite a second account, refuse a third), then tag `phase-0`.

## 8. Next steps for this session, in order

1. Apply §6 doc edits and commit.
2. Rename the Caddy block to `portal.dsw.test`, add `map.dsw.test`, set `AUTH_URL`/`COOKIE_DOMAIN`, redeploy, re-issue the bootstrap invite, and post the new link in `11-status.md`.
3. Add `wireguard`, `map-relay` and the `apps/api` skeleton (Fastify, `/health`, service-token middleware, `AMP_MOCK` client) to compose. Generate VPS keys, write `wg0.conf.example`, print the public key in `11-status.md` for Alex. Bring the trio up; `api` `/health` will report `tunnel: down` until the AMP host peer exists, which is expected.
4. Move nothing else yet; then start **Phase 1** exactly as docs/10 lists it: `/mods`, `/vote`, `/vote/results`, `/admin/votes`, `packages/modpack` with `lint` and `verify-links`, `modpack/mods.json` populated from docs/06 with every slug verified against the Modrinth API and real video links. The vote page that Alex's friends saw was a static prototype; its copy and structure (categories, load chips, "pick one gun mod", settings questions) are the spec for `/vote`.
5. Update `11-status.md` at the end of the session as before.
