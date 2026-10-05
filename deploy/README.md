# Deploying on vps-01v

**One way only:** `sudo deploy/deploy.sh` (git pull, pull the two images from GHCR, `up -d`, prune). Details in `docs/09-ops.md`.

The VPS never builds images: a build here ran the box out of memory on 2026-09-29. Images come from GitHub Actions (`.github/workflows/ci.yml`) on every push to `main`. Never `docker compose up --build` on this host.

First time:

```
cd /home/ladm/Minecraft-site
cp deploy/.env.example deploy/.env   # fill in, including GHCR_OWNER
docker login ghcr.io                 # once, token with read:packages
sudo deploy/deploy.sh
# first admin without Discord configured:
docker exec deepslate-web node apps/web/scripts/invite.mjs "for Alex"
```

Caddy: add the block from `deploy/Caddyfile.snippet` to `/home/ladm/docker/web-proxy/etc/Caddyfile`, then as ladm `docker exec caddy caddy validate --config /etc/caddy/Caddyfile` and `docker exec caddy caddy reload --config /etc/caddy/Caddyfile` (more in /home/ladm/docker/HOSTING.md).
Update: `deploy/check.sh` first, push to `main` as `ladm` (`runuser -u ladm -- git push`), wait for the `ci` workflow to go green, `sudo deploy/deploy.sh`. Migrations run on container start; dump the database before one (docs/09).
Roll back: `sudo IMAGE_TAG=<commit sha> deploy/deploy.sh`.
Logs: `docker logs -f deepslate-web`. Health: `https://deepslate.dsw.test/api/health`.
