# Deploying on docker-01v (the home stack, planner doc 62)

**One way only:** `sudo deploy/home/deploy.sh` (git pull, pull the two images from GHCR, `up -d`, prune), from the
checkout at `DEEPSLATE_DIR`. The VPS keeps `deploy/deploy.sh` and `deploy/docker-compose.yml` until the cutover; the
two never run on the same host.

The checkout follows `main` (what is deployed). For the dry run of doc 62 §5.4 it follows `dev`: `deploy.sh` then
checks the checkout against `origin/dev` instead of `origin/main`, and nothing else. Images exist only for the `dev`
commits that changed something an image is made of (the workflow dev-images), so pin the newest of those:
`sudo IMAGE_TAG=<its full sha> deploy/home/deploy.sh`. While the VPS's api is still the one that talks to Discord, the
dry run sets `DISCORD_TALKS=0` with the bot token in place: sign-in can ask whether an account is in the Discord server,
and no second bot comes online. The cutover removes that line.

## What is in this folder

| File | What it is |
|---|---|
| `docker-compose.yml` | The home stack: the site's newt, postgres, caddy, web, api, one map relay, backups, geoipupdate (profile `geoip`), the test pair (profile `test`) and the designer (profile `designer`). Four networks named for the host's firewall: `ds-edge` (made once before the stack, so it outlives a `compose down`), `ds-web`, `ds-amp`, `ds-internal` |
| `Caddyfile` | The stack's own Caddy on :80 behind the newt: the site, the map (login enforced by the portal) and the test site, host names from `.env`; trusts forwarded headers from `ds-edge` only and passes one `X-Forwarded-For` on |
| `.env.example` | Every variable the home stack reads. Copy to `deploy/home/.env` (git-ignored) and replace every `replace-me-...` and all-zero id |
| `deploy.sh` | The one way to deploy; `check.sh` runs the checks from this folder (`../check.sh`) |
| `test-up.sh` | Starts the test pair or puts it on new images (`sudo deploy/home/test-up.sh`); `deploy.sh` runs it while `TEST_STACK=1` |

What runs apart: the host's `deepslate-firewall` service, which gates the four networks by bridge name. The newt
(`deepslate-newt`, the service `newt`) is Pangolin's tunnel client for the site `deepslate`: its id and secret are
`NEWT_ID` and `NEWT_SECRET` in `.env`, with the stack's other secrets. Until 2026-10-23 it ran as a stack of its own
under Dockhand; now one `deploy.sh` starts, updates and stops everything the site needs.

## Where things live

- `DEEPSLATE_DIR` (`/data/stacks/deepslate`): this checkout. `web` mounts `modpack/` and `.git` (Admin → Lock commits
  there), `api` mounts `modpack/`, `installer/` and `deploy/keys` (the rrsync key, uid 1000, plus `known_hosts`).
- `DEEPSLATE_DATA` (`/data/appdata/deepslate`): `postgres/` (70:70, 700), `backups/` (70:70, the nightly dumps),
  `dist/` and `data/` (uid 1000: built packs, uploaded pictures, builds, private jars), `geoip/`, `caddy/`.
  `deploy.sh` makes them with those owners.
- The AMP host is reached on the LAN: `AMP_HOST`, `AMP_URL`, `ROUTER_DASH_URL`, `RSYNC_TARGET` in `.env`. The AMP host
  admits this host alone on 8090 and 8100 (its nftables), and the rrsync key's `from=` names this host.
- `/api/health` keeps its `tunnel` field: at home it is a TCP check of the AMP host's sshd over the LAN.

First time (after the folders and the network exist: docker-01v's L3 made both):

```
cd /data/stacks/deepslate                      # the checkout, owned by the deploy user (uid 1000)
cp deploy/home/.env.example deploy/home/.env   # fill it in, the newt's id and secret included (Pangolin → Sites → deepslate)
docker login ghcr.io                           # once, a token with read:packages
sudo deploy/home/deploy.sh
```

The `.git/config` and `.git/hooks` guards are the VPS's (`deploy/README.md`): make `/root/.config/deepslate/git-config.expected`
and `git-hooks.expected` once, as root, after reading both by eye.

Pangolin: three HTTP resources on the site `deepslate`, `SITE_HOST`, `MAP_HOST` and `TEST_HOST`, all to
`deepslate-caddy:80`, Pangolin's own login off, CrowdSec's http scenarios bypassed for the hosts. Authentik: the
provider's redirect URIs for `AUTH_URL` and `TEST_AUTH_URL`.

Since 2026-10-23 everything the VPS ran is here, in the one stack: the test pair (`TEST_STACK=1`; its checkout at
`TEST_DIR`, on dev, brought forward with `deploy/test-pull.sh <TEST_DIR>` as its owner) and the designer (`DESIGNER_CMD`
set; its host user `designer`, uid 1010, with the CLI installed and signed in, docs/39; on `ds-web`, so it reaches public
https and nothing private). Not here: the Dockhand mirror (dropped, doc 62 §1.5). Roll back: `sudo IMAGE_TAG=<commit sha>
deploy/home/deploy.sh`.
Logs: `docker logs -f deepslate-web`. The Discord bot runs in `api`: exactly one live api, so the VPS's api is stopped
before this one starts (the cutover, doc 62 §5.5).
