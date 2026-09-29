# 09 · Deployment, security, operations

## VPS layout

```
/home/ladm/Minecraft-site/            git checkout of this repo (owned by ladm)
/home/ladm/Minecraft-site/deploy/.env
/home/ladm/Minecraft-site/deploy/wireguard/wg_confs/wg0.conf   git-ignored
/home/ladm/Minecraft-site/deploy/keys/deploy.key               git-ignored, mounted read-only into api
/root/docker/deepslate/postgres, /root/docker/deepslate/backups
```

`deploy/docker-compose.yml` (no `build:` sections, `pull_policy: always` on our two images) services: `web`, `api`, `wireguard`, `map-relay-inner`, `map-relay-outer`, `postgres`, `backups`. Caddy is the existing `web-proxy` stack; the app publishes no ports except UDP 51820 (WireGuard). AMP stays on the homelab.

## Deploying (the only way)

**The VPS never builds images.** It has 7.7 GB shared with every other site on the box; on 2026-09-29 a `docker compose up --build` here used all of it and the kernel killed live services (see docs/11 "OOM incident"). Images are built by GitHub Actions and pulled.

```
push to main ──► .github/workflows/ci.yml
                   check:  lint, typecheck, test
                   images: build apps/web + apps/api (docker/build-push-action, cache type=gha)
                           push ghcr.io/blake-dk/deepslate-web:{sha,latest}
                                ghcr.io/blake-dk/deepslate-api:{sha,latest}
on the VPS  ──► sudo /home/ladm/Minecraft-site/deploy/deploy.sh
                   git pull --ff-only  →  docker compose pull web api  →  docker compose up -d  →  docker image prune -f
```

- `deploy/deploy.sh` refuses to run without swap, with under 600 MB available, or without `GHCR_OWNER` in `deploy/.env`; it waits for `deepslate-web` to report healthy and prints the health JSON.
- Roll back or pin: `sudo IMAGE_TAG=<commit sha> deploy/deploy.sh` (every push keeps its `:sha` image).
- It pulls only `web` and `api`. Postgres, WireGuard and socat images are updated deliberately, never as a side effect of a deploy.
- The images are private. The VPS is logged in to `ghcr.io` once (`docker login ghcr.io`, a token with `read:packages`); the login lives in `/root/.docker/config.json`.
- Never run `docker compose up --build`, `docker compose build` or `docker build` on the VPS. tooling sessions on this host are blocked from doing so by a hook (`/root/.tooling/hooks/mem-guard.py`), which also refuses `docker run` without `--memory`.
- If CI is down and a change cannot wait: build on another machine and `docker save | ssh vps docker load`, then `IMAGE_TAG` to match. A build on the VPS is the last resort and Alex's call: stop the non-essential stacks first, one image at a time, through the memory-capped builder (`docker buildx use capped`, 2 GB), then start the stacks again.

## Dockhand (pull-only)

The stack is registered in Dockhand (`http://100.64.0.10:3690`, environment **VPS-01V**, stack `deepslate`) like the other stacks on the VPS, so it can be watched, pulled and restarted from there.

- **Pull-only.** The compose file has no `build:` section, so nothing Dockhand does can build on the VPS; `deploy/dockhand-sync.py` refuses to mirror a compose file that has one. "Update" / "Redeploy" in Dockhand means: pull `ghcr.io/blake-dk/deepslate-{web,api}` and recreate what changed.
- **The repo is the source of truth, Dockhand holds a mirror.** Dockhand's agent on the VPS is sandboxed and cannot read `/home`, so it runs the stack from its own copy in `/data/stacks/deepslate/` (`compose.yaml`, `.env`). `deploy/deploy.sh` refreshes the mirror after every deploy (`deploy/dockhand-sync.py`, which never restarts anything). Edit `deploy/docker-compose.yml` and `deploy/.env`, never the copy in Dockhand: the next deploy overwrites it. After editing `deploy/.env` by hand, run `sudo deploy/deploy.sh` (or `sudo deploy/dockhand-sync.py`) so Dockhand does not redeploy with the old values.
- Because the stack runs from two directories, every host path in the compose file is built from `DEEPSLATE_DIR` (absolute, in `deploy/.env`). A relative path there would make a redeploy from Dockhand mount empty directories.
- The env mirror contains the stack's secrets, as for the other stacks in Dockhand.
- What Dockhand does not do: `git pull`. New installer files or a new `modpack/` arrive with `deploy/deploy.sh`. For a code change use `deploy.sh`; use Dockhand to look, restart, or pull the newest images.
- Registry: Dockhand pulls with its own `ghcr.io` credentials (Settings → Registries → "GitHub"), not with the login in `/root/.docker/config.json`.
- `deploy/dockhand-sync.py --check` reports whether the mirror matches.

## Memory limits

| Service | `mem_limit` | Notes |
|---|---|---|
| `web` | 768m | Next.js server; no longer runs builds |
| `api` | 512m | includes `modpack build`, a child process with a 256 MB heap that is first in line if the container runs out |
| `postgres` | 256m | `shared_buffers=128MB` set explicitly |
| `wireguard` 128m, relays 32m each, `backups` 64m | | |

Host: 4 GB swapfile (`/swapfile`, `vm.swappiness=10`) so a spike slows the box down instead of killing things; `earlyoom` stops build tools and headless browsers first and spares the proxy, databases, Docker and SSH.

`modpack build` (jar downloads, `.mrpack`, installer zip) runs inside `api`: Admin → Modpack → Build calls `POST /modpack/build` and streams the output line by line. Jars are streamed to disk and hashed in chunks, never held in memory. Measured 2026-09-29: 11 jars, 17.8 MB, peak 75 MB. `dist/` belongs to uid 1000 (api writes, web reads; `deploy.sh` sets the owner). Do not run the CLI's `build` in a one-off container on the host.

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
- Rotate AMP password → `.env`, then `sudo deploy/deploy.sh`.
- The box is short of memory → `free -m`, `docker stats --no-stream`, `journalctl -k | grep -i "killed process"`, `journalctl -u earlyoom`. Every container has a limit, so a container that grows is killed inside its own limit; look for something running outside one.
