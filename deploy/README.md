# Deploying on vps-01v

**One way only:** `sudo deploy/deploy.sh` (git pull, pull the two images from GHCR, `up -d`, prune). Details in `docs/09-ops.md`.

## What is in this folder

Everything needed to run the stack is here; nothing else on the host is part of it.

| File | What it is |
|---|---|
| `docker-compose.yml` | The whole stack: postgres, web, the WireGuard sidecar, api, the two map relays, the two mc-router dashboard relays and the nightly backups. Used as it is; no secrets in it, they all come from `.env` |
| `.env.example` | Every variable the stack reads, each with a comment and a placeholder value. Copy it to `.env` (git-ignored) and replace every `replace-me-...` and all-zero id; `deploy.sh` refuses to run while one is left |
| `wireguard/wg0.conf.example` | The tunnel to the homelab. Copy to `wireguard/wg_confs/wg0.conf` (git-ignored) |
| `Caddyfile.snippet` | The block to add to the host's Caddy for the site and the map |
| `deploy.sh` | The one way to deploy (below) |
| `check.sh` | Typecheck, lint and tests in a memory-capped container |
| `dockhand-sync.py` | Mirrors `docker-compose.yml` and `.env` into Dockhand after a deploy; never starts or stops anything |
| `backup-loop.sh` | The nightly database dump, run by the `backups` container |
| `ops-lock.sh` | One deploy, build or sync at a time; sourced by `deploy.sh` |
| `server-mods.sh` | Copies the mods the server loaded at its last start into `modpack/server-loaded.json` |

Placeholders in `.env.example`: `replace-me-...` for secrets (where one is generated, the comment gives the command), all zeros for Discord and AMP ids, `*.dsw.test` for domains, `10.77.0.x` (tunnel) and `100.64.0.x` (tailnet) for addresses. The real values live only in `deploy/.env` on the VPS.

The VPS never builds images: a build here ran the box out of memory on 2026-09-29. Images come from GitHub Actions (`.github/workflows/ci.yml`) on every push to `main`. Never `docker compose up --build` on this host.

First time:

```
cd /home/ladm/Minecraft-site
cp deploy/.env.example deploy/.env   # replace every replace-me and all-zero id
docker login ghcr.io                 # once, token with read:packages
sudo deploy/deploy.sh
# first admin without Discord configured:
docker exec deepslate-web node apps/web/scripts/invite.mjs "for Alex"
```

Caddy: add the block from `deploy/Caddyfile.snippet` to `/home/ladm/docker/web-proxy/etc/Caddyfile`, then as ladm `docker exec caddy caddy validate --config /etc/caddy/Caddyfile` and `docker exec caddy caddy reload --config /etc/caddy/Caddyfile` (more in /home/ladm/docker/HOSTING.md).
Update: `deploy/check.sh` first, push to `main` as `ladm` (`runuser -u ladm -- git push`), wait for the `ci` workflow to go green, `sudo deploy/deploy.sh`. Migrations run on container start; dump the database before one (docs/09).
Roll back: `sudo IMAGE_TAG=<commit sha> deploy/deploy.sh`.
`.git/config` check: `deploy.sh` stops before the fetch when `.git/config` differs from `/root/.config/deepslate/git-config.expected` (a copy `web` cannot reach, since `web` can write `.git`), and prints the difference.
When the change is yours (a new remote, a credential helper you set), read `.git/config` by eye and remake the copy as root: `install -d -m 700 /root/.config/deepslate && runuser -u ladm -- git -C /home/ladm/Minecraft-site config --local --list | sort > /root/.config/deepslate/git-config.expected && chmod 600 /root/.config/deepslate/git-config.expected`.
Logs: `docker logs -f deepslate-web`. Health: `https://deepslate.dsw.test/api/health`.
