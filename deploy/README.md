# Deploying on vps-01v

**One way only:** `sudo deploy/deploy.sh` (git pull, pull the two images from GHCR, `up -d`, prune). Details in `docs/09-ops.md`.

## What is in this folder

Everything needed to run the stack is here; nothing else on the host is part of it.

| File | What it is |
|---|---|
| `docker-compose.yml` | The whole stack: postgres, web, the WireGuard sidecar, api, the two map relays, the build designer (docs/39, only while `DESIGNER_CMD` is set), the test server's pair (docs/42, only while `TEST_STACK=1`) and the nightly backups. Used as it is; no secrets in it, they all come from `.env` |
| `.env.example` | Every variable the stack reads, each with a comment and a placeholder value. Copy it to `.env` (git-ignored) and replace every `replace-me-...` and all-zero id; `deploy.sh` refuses to run while one is left |
| `wg0.conf.example` | The tunnel to the homelab. Copy to `wireguard/wg_confs/wg0.conf`. The whole `wireguard/` folder is git-ignored and belongs to uid 1000, the tunnel container |
| `Caddyfile.snippet` | The blocks to add to the host's Caddy for the site and the map, and for the test site once it is set up |
| `deploy.sh` | The one way to deploy (below) |
| `check.sh` | Typecheck, lint and tests in a memory-capped container |
| `dockhand-sync.py` | Mirrors `docker-compose.yml` and `.env` into Dockhand after a deploy; never starts or stops anything |
| `backup-loop.sh` | The nightly database dump, run by the `backups` container |
| `ops-lock.sh` | One deploy, build or sync at a time; sourced by `deploy.sh` |
| `server-mods.sh` | Copies the mods the server loaded at its last start into `modpack/server-loaded.json` |
| `test-up.sh` | docs/42: pulls the test images and starts `web-test` and `api-test` (makes the database `deepslate_test` when missing). `deploy.sh` runs it without the pull while `TEST_STACK=1` |
| `test-pull.sh` | docs/42: brings the test checkout (`TEST_DIR`, on `dev`) to `origin/dev`, as ladm |
| `test-db-reset.sh` | docs/42: drops and remakes `deepslate_test`; refuses any other name |
| `test-env.sh` | The checks of the `TEST_` lines in `.env`, sourced by `deploy.sh` and `test-up.sh` |
| `keys-test/` | Git-ignored, made by hand: the test instance's own deploy key (`deploy.key`, uid 1000) and `known_hosts` |

Placeholders in `.env.example`: `replace-me-...` for secrets (where one is generated, the comment gives the command), all zeros for Discord and AMP ids, `*.dsw.test` for domains, `10.77.0.x` (tunnel) and `100.64.0.x` (tailnet) for addresses. The real values live only in `deploy/.env` on the VPS.

**The tunnel takes no connections from the homelab.** api (4000), the test server's api (4001, docs/42) and the inner map relay (8100) listen on 0.0.0.0 in the tunnel's namespace. Their callers reach them over `internal` (eth0); each calls the homelab out over wg0 and the replies come back on that connection. Nothing on the homelab end opens one, so the live `wg_confs/wg0.conf` drops them on wg0 (8090 is from the mc-router dashboard relay, taken out on 2026-10-07; api reads that dashboard itself now, and the rule is harmless):

```
PostUp = iptables -I INPUT -i wg0 -p tcp -m multiport --dports 4000,4001,8090,8100 -j DROP
PostDown = iptables -D INPUT -i wg0 -p tcp -m multiport --dports 4000,4001,8090,8100 -j DROP
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

## The test server (docs/42)

A hidden copy of the site for the AMP instance `DeepslateTest01`: `web-test` and `api-test` (compose profile `test`),
the database `deepslate_test` in the same Postgres, a checkout of its own on `dev` (`TEST_DIR`), images built by CI on
each push to `dev` (the workflow `dev-images`, tag `dev`). The test site follows `dev`; the live site follows `main`. Off unless `TEST_STACK=1` in `.env`; then `deploy.sh` checks the `TEST_`
lines before anything and starts the pair after the live stack is healthy, and never waits on it. With it off,
`deploy.sh` removes the two containers.

First time, after the AMP host's half (docs/42a) and the `TEST_` block in `.env` (every line is in `.env.example`):

```
git clone -b dev https://github.com/Blake-DK/deepslate-works.git /home/ladm/Minecraft-site-test   # as ladm
sudo install -d -o 1000 -g 1000 -m 700 deploy/keys-test                                            # then the key as deploy/keys-test/deploy.key, uid 1000, mode 600
sudo cp deploy/keys/known_hosts deploy/keys-test/known_hosts                                       # the same AMP host
sudo deploy/test-up.sh
```

New code on the test site: push to `dev`, wait for Actions → `dev-images` (about five minutes), then
`sudo deploy/test-up.sh`; it prints the commit the test site is now on. A push that changes only docs, `deploy/`,
`tools/` or another workflow builds nothing. Another ref: run `test-images` for it, set `TEST_IMAGE_TAG=test` in `.env`,
then `sudo deploy/test-up.sh`. New pack or season files: `deploy/test-pull.sh` (as ladm); they are read from the
checkout. The test site's footer says when the images and the checkout are not the same commit. Caddy: the last block of `Caddyfile.snippet`, with the real names.

