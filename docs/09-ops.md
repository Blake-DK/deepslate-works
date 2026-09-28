# 09 · Deployment, security, operations

## VPS layout

```
/opt/deepslate/            git checkout of this repo
/opt/deepslate/deploy/.env
/var/lib/deepslate/postgres
<AMP instance dir>/Minecraft/   e.g. /home/amp/.ampdata/instances/DeepslateWorks01/Minecraft
```

`docker-compose.yml` services: `caddy`, `web`, `postgres`. AMP stays as it is installed today. `web` mounts the AMP instance directory read-write at `/amp-instance` **only** for `modpack sync-server` and stats reads; the mount is the single place the app touches the server's files.

## Caddyfile (shape)

```
deepslate.example.com {
  reverse_proxy web:3000
  rate_limit { zone login { key {remote_host} events 10 window 1m } }   # on /api/auth/* and /join/*
  encode zstd gzip
}
map.deepslate.example.com {
  forward_auth web:3000 { uri /api/auth/verify; copy_headers X-User }
  reverse_proxy host.docker.internal:8100     # BlueMap webserver, bound to localhost on the host
  @unauth expression `{http.error.status_code} == 401`
  handle_errors { redir https://deepslate.example.com/login?next={uri} }
}
```

## `.env.example`

```
DATABASE_URL=postgresql://deepslate:…@postgres:5432/deepslate
AUTH_SECRET=                      # openssl rand -base64 32
AUTH_URL=https://deepslate.example.com
COOKIE_DOMAIN=.deepslate.example.com
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
ADMIN_DISCORD_ID=                 # first login from this id becomes ADMIN
AMP_URL=http://host.docker.internal:8081   # the Minecraft instance's own port, not ADS
AMP_USERNAME=webapp
AMP_PASSWORD=
AMP_INSTANCE_DIR=/amp-instance
AMP_MOCK=0
MODRINTH_USER_AGENT=deepslate-works/0.1 (alex@example.com)
MAP_URL=https://map.deepslate.example.com
```

## Security checklist

- Only 80/443 (Caddy) and 25565 (Minecraft) and the voice chat UDP port (Simple Voice Chat, default 24454) open on the VPS firewall. AMP's web UI and BlueMap stay on localhost or behind a VPN/Tailscale.
- AMP `webapp` user: least privilege, one instance, no file-manager delete, no ADS rights. Rotate the password if it ever leaks into a log.
- Players never see raw console lines; admins do.
- All player-supplied strings that end up in a command are validated by a strict regex or an enum. There is no free-text command path for players.
- CSRF: Auth.js handles its routes; app POSTs use same-site cookies + origin check in middleware.
- Dependencies pinned; `pnpm audit` in CI.
- Backups: Postgres `pg_dump` nightly to `/var/backups/deepslate/` (7 kept); Minecraft world backups via AMP's backup plugin nightly (keep 7 daily, 4 weekly). Both restore procedures written down in `docs/runbook.md` when Phase 3 lands.

## Observability

- App logs to stdout (JSON in prod), `docker compose logs web`.
- `/api/health` returns 200 with db + AMP reachability; UptimeRobot or similar pings it.
- Every AMP call logged with duration; slow (>2 s) calls warned.
- `ServerSnapshot` doubles as a poor man's metrics store; prune >7 days nightly.

## Runbook stubs (fill in as phases land)

- Server won't start after a mod change → `modpack sync-server --rollback` restores the previous `mods/` (keep the last two `dist/server` builds on disk).
- A player can't connect ("mod mismatch") → check the pack version on `/install` vs `installed.json` on their PC; re-run installer.
- Restore world from backup → AMP UI, backups tab, or documented CLI.
- Rotate AMP password → `.env`, `docker compose up -d web`.
