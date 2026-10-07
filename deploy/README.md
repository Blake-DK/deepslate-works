# Deploying on vps-01v

**One way only:** `sudo deploy/deploy.sh` (git pull, pull the two images from GHCR, `up -d`, prune). Details in `docs/09-ops.md`.

## What is in this folder

Everything needed to run the stack is here; nothing else on the host is part of it.

| File | What it is |
|---|---|
| `docker-compose.yml` | The whole stack: postgres, web, the WireGuard sidecar, api, the two map relays, the two mc-router dashboard relays, the build designer (docs/39, only while `DESIGNER_CMD` is set) and the nightly backups. Used as it is; no secrets in it, they all come from `.env` |
| `.env.example` | Every variable the stack reads, each with a comment and a placeholder value. Copy it to `.env` (git-ignored) and replace every `replace-me-...` and all-zero id; `deploy.sh` refuses to run while one is left |
| `wg0.conf.example` | The tunnel to the homelab. Copy to `wireguard/wg_confs/wg0.conf`. The whole `wireguard/` folder is git-ignored and belongs to uid 1000, the tunnel container |
| `Caddyfile.snippet` | The block to add to the host's Caddy for the site and the map |
| `deploy.sh` | The one way to deploy (below) |
| `check.sh` | Typecheck, lint and tests in a memory-capped container |
| `dockhand-sync.py` | Mirrors `docker-compose.yml` and `.env` into Dockhand after a deploy; never starts or stops anything |
| `backup-loop.sh` | The nightly database dump, run by the `backups` container |
| `ops-lock.sh` | One deploy, build or sync at a time; sourced by `deploy.sh` |
| `server-mods.sh` | Copies the mods the server loaded at its last start into `modpack/server-loaded.json` |

Placeholders in `.env.example`: `replace-me-...` for secrets (where one is generated, the comment gives the command), all zeros for Discord and AMP ids, `*.dsw.test` for domains, `10.77.0.x` (tunnel) and `100.64.0.x` (tailnet) for addresses. The real values live only in `deploy/.env` on the VPS.

**The tunnel takes no connections from the homelab.** api (4000), the inner map relay (8100) and the inner mc-router dashboard relay (8090) all listen on 0.0.0.0 in the tunnel's namespace. Their callers reach them over `internal` (eth0); each relay calls the homelab out over wg0 and the replies come back on that connection. Nothing on the homelab end opens one, so the live `wg_confs/wg0.conf` drops all three on wg0:

```
PostUp = iptables -I INPUT -i wg0 -p tcp -m multiport --dports 4000,8090,8100 -j DROP
PostDown = iptables -D INPUT -i wg0 -p tcp -m multiport --dports 4000,8090,8100 -j DROP
```

A new listener in that namespace joins the list unless something on the homelab must reach it; then it gets an accept from that one address on wg0 only. Git keeps nothing inside `wireguard/`: `deploy.sh` gives that folder to uid 1000 at every deploy, and `git pull` as ladm cannot write there.

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

`.git/hooks` check: the same for hooks (`deploy/git-guard.sh`). `deploy.sh` stops when `.git/hooks` holds anything but `.sample` files and the hooks listed with their sha256 in `/root/.config/deepslate/git-hooks.expected`, or when `core.hooksPath` is set anywhere git reads it. `deploy.sh`'s own git runs no hooks; every other git command on the host does, as ladm. After reading each hook by eye, as root: `(cd /home/ladm/Minecraft-site/.git/hooks && sha256sum pre-push) > /root/.config/deepslate/git-hooks.expected && chmod 600 /root/.config/deepslate/git-hooks.expected`.
Logs: `docker logs -f deepslate-web`. Health: `https://deepslate.dsw.test/api/health`.
