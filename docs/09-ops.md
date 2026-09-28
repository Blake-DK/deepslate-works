# 09 · Deployment, security, operations

## VPS layout

```
/home/ladm/Minecraft-site/            git checkout of this repo (owned by ladm)
/home/ladm/Minecraft-site/deploy/.env
/home/ladm/Minecraft-site/deploy/wireguard/wg_confs/wg0.conf   git-ignored
/home/ladm/Minecraft-site/deploy/keys/deploy.key               git-ignored, mounted read-only into api
/root/docker/deepslate/postgres, /root/docker/deepslate/backups
```

`deploy/docker-compose.yml` services: `web`, `api`, `wireguard`, `map-relay-inner`, `map-relay-outer`, `postgres`, `backups`. Caddy is the existing `web-proxy` stack; the app publishes no ports except UDP 51820 (WireGuard). AMP stays on the homelab.

## Caddy (blocks in `/root/docker/web-proxy/etc/Caddyfile`)

```
deepslate.dsw.test {
	import common
	header X-Frame-Options SAMEORIGIN
	reverse_proxy deepslate-web:3000
}
map.deepslate.dsw.test {
	import common
	forward_auth deepslate-web:3000 { uri /api/auth/verify }
	reverse_proxy deepslate-map-relay-outer:8100
	handle_errors {
		@unauth expression {http.error.status_code} == 401
		redir @unauth https://deepslate.dsw.test/login?next=https://map.deepslate.dsw.test{uri}
	}
}
```

Reload recipe in `deploy/README.md`. The map block 502s harmlessly until BlueMap exists (Phase 3).

## `.env.example`

See `deploy/.env.example` (kept current; every variable commented). Notables: `API_URL`/`API_SERVICE_TOKEN` (web → api), `AMP_URL=http://10.77.0.2:8080`, `AMP_INSTANCE_ID`, `AMP_TUNNEL_IP=10.77.0.2`, `RSYNC_TARGET=amp@10.77.0.2:`, `COOKIE_DOMAIN=.deepslate.dsw.test`, `MAP_URL=https://map.deepslate.dsw.test`, `DISCORD_GUILD_ID` (optional server gate). No `AMP_INSTANCE_DIR`.

## Security checklist

- VPS firewall (`/usr/local/sbin/host-firewall.sh`): 80/443 (Caddy), UDP 51820 (WireGuard, any source; unauthenticated packets are dropped by WireGuard), SSH rule unchanged. Game and voice ports are Pangolin's business on the homelab, not the VPS. AMP's web UI and BlueMap are reachable only over the tunnel.
- Keys in `deploy/wireguard/` and `deploy/keys/` are git-ignored; the VPS host has no route into the tunnel, only the tunnel namespace does.
- AMP `webapp` user: ADS-level login with rights on the one instance only, file manager read, no delete, no ADS admin rights. Rotate the password if it ever leaks into a log.
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
