# Deploying on docker-01v (the home stack, planner doc 62)

**Two ways, the same result:** a redeploy of the stack (`docker compose -f deploy/home/docker-compose.yml --env-file
deploy/home/.env up -d`, or Redeploy in Dockhand), or `sudo deploy/home/deploy.sh`, which does the same with its own
checks around it (the commit's own images, the health of web and api after). The VPS keeps `deploy/deploy.sh` and
`deploy/docker-compose.yml` until the cutover; the two never run on the same host.

**The live stack is Dockhand's own copy** (since 2026-10-28): Dockhand's stack `deepslate` (Docker-01V) keeps its
compose file and `.env` in its own data folder, where they can be edited and redeployed from Dockhand. The checkout
stays clean, so `repo-sync` can always move it. This folder's `docker-compose.yml` and `.env.example` are the reference:
a change to them reaches the live stack only when it is pasted into Dockhand. `deploy/home/.env` stays for `deploy.sh`
and `test-up.sh`; a secret changed in one place has to be changed in the other.

## What a redeploy does

Every image is pulled (`IMAGE_TAG`, normally `latest`: main's newest), then one-shot steps run before the site starts.
Each exits when done; `docker compose ps -a` lists them and `docker logs deepslate-<step>` says what it did.

| Step | What it does | When it cannot |
|---|---|---|
| `init` | the data folders with their owners (root with CHOWN, FOWNER, DAC_OVERRIDE, no network) | fails: nothing starts |
| `repo-sync` | the checkout to `origin/main` (or `origin/dev`), as its owner, with the `.git/config` and hooks guards below | says why in its log and goes on: the stack starts on the checkout as it was. Unpushed commits, a guard that does not match, a hold, no network |
| `installer` | `DeepslateWorks.exe` into `dist/ci` when it changed | nothing waits on it |
| `db-prep` | a dump to `backups/pre-deploy-*.sql.gz` (newest 10 kept), and `deepslate_test` when `TEST_STACK=1` and it is missing | fails: no migration, web and api stay down until it is fixed |
| `migrate` | `prisma migrate deploy` of the web image | fails: web and api stay down, as a failed migration always did |

Compose removes the old containers before these steps run, so a step that fails leaves every service after it stopped,
not the old ones running. That is why only `init`, `db-prep` and `migrate` ever fail, and why nothing waits for a build
or sync in api to finish: do not redeploy while Admin → Modpack shows one running.

**The database** follows the newest PostgreSQL (`deploy/images/db`: pgautoupgrade). When the image is a new major, it
copies the stopped data to `postgres-pre-upgrade/` (the newest two copies kept), upgrades in place and starts; about a
minute. It refuses data that was not shut down cleanly, or that it would not find, rather than start an empty database.
It and `backups` follow `latest` only, never `IMAGE_TAG`: an upgraded data folder cannot be started by an older
PostgreSQL, so rolling web and api back must not take the database with them.

**Optional services** run while `COMPOSE_PROFILES` in `.env` names them: `designer`, `geoip`, `test`.

**A change to `docker-compose.yml` itself** is read on the redeploy after the one whose `repo-sync` pulled it (compose
has read the file before the step runs). Caddy's Caddyfile, `backup-loop.sh`, the designer's server and the installer
files are inside their images, so they arrive with the first redeploy.

**Dockhand** needs a GHCR login with `read:packages`: `deepslate-web`, `deepslate-api` and `deepslate-installer` are
private packages (`deepslate-db`, `-backups`, `-caddy`, `-designer` and `-ops` are public). A Redeploy with "pull" does
not log in for the private ones and quietly keeps the old image: pull those three first (Images → Pull, which uses
Dockhand's GitHub registry), then redeploy. It runs the stack with its own copy of the compose file and `.env` (above).

Roll back: `IMAGE_TAG=<commit sha>` in `.env`, then redeploy (or `sudo IMAGE_TAG=<sha> deploy/home/deploy.sh`). A
migration has no way back but the `pre-deploy-*` dump before it.

The checkout follows `main` (what is deployed). For the dry run of doc 62 §5.4 it follows `dev`: `deploy.sh` then
checks the checkout against `origin/dev` instead of `origin/main`, and nothing else. Images exist only for the `dev`
commits that changed something an image is made of (the workflow dev-images), so pin the newest of those:
`sudo IMAGE_TAG=<its full sha> deploy/home/deploy.sh`. While the VPS's api is still the one that talks to Discord, the
dry run sets `DISCORD_TALKS=0` with the bot token in place: sign-in can ask whether an account is in the Discord server,
and no second bot comes online. The cutover removes that line.

## What is in this folder

| File | What it is |
|---|---|
| `docker-compose.yml` | The home stack: the one-shot steps (init, repo-sync, installer, db-prep, migrate), the site's newt, postgres, caddy, web, api, one map relay, backups, geoipupdate (profile `geoip`), the test pair (profile `test`) and the designer (profile `designer`). Four networks named for the host's firewall: `ds-edge` (made once before the stack, so it outlives a `compose down`), `ds-web`, `ds-amp`, `ds-internal` |
| `Caddyfile` | The stack's own Caddy on :80 behind the newt: the site, the map (login enforced by the portal) and the test site, host names from `.env`; trusts forwarded headers from `ds-edge` only and passes one `X-Forwarded-For` on |
| `.env.example` | Every variable the home stack reads. Copy to `deploy/home/.env` (git-ignored) and replace every `replace-me-...` and all-zero id |
| `deploy.sh` | Deploys with its own checks (a redeploy of the stack does the same without them); `check.sh` runs the checks from this folder (`../check.sh`) |
| `test-up.sh` | Starts the test pair or puts it on new images (`sudo deploy/home/test-up.sh`); `deploy.sh` runs it while `TEST_STACK=1` |
| `../images/` | The stack's own images, built by CI: `db`, `backups`, `caddy`, `designer`, `ops` (init and repo-sync), `installer` |

What runs apart: the host's `deepslate-firewall` service, which gates the four networks by bridge name. The newt
(`deepslate-newt`, the service `newt`) is Pangolin's tunnel client for the site `deepslate`: its id and secret are
`NEWT_ID` and `NEWT_SECRET` in `.env`, with the stack's other secrets. Until 2026-10-23 it ran as a stack of its own
under Dockhand; now one `deploy.sh` starts, updates and stops everything the site needs.

## Where things live

- `DEEPSLATE_DIR` (`/nvme/stacks/deepslate`): this checkout. `web` mounts `modpack/` and `.git` (Admin → Lock commits
  there), `api` mounts `modpack/`, `installer/` and `deploy/keys` (the rrsync key, uid 1000, plus `known_hosts`).
- `DEEPSLATE_DATA` (`/nvme/appdata/deepslate`): `postgres/` (70:70, 700), `backups/` (70:70, the nightly dumps),
  `dist/` and `data/` (uid 1000: built packs, uploaded pictures, builds, private jars), `geoip/`, `caddy/`.
  `deploy.sh` makes them with those owners.
- Both roots are on docker-01v's `/nvme` disk since 2026-10-28 (the test checkout too, `/nvme/stacks/deepslate-test`).
  `/data` is kept for media downloads, so a full download disk no longer stops the site.
- The AMP host is reached on the LAN: `AMP_HOST`, `AMP_URL`, `ROUTER_DASH_URL`, `RSYNC_TARGET` in `.env`. The AMP host
  admits this host alone on 8090 and 8100 (its nftables), and the rrsync key's `from=` names this host.
- `/api/health` keeps its `tunnel` field: at home it is a TCP check of the AMP host's sshd over the LAN.

First time (after the folders and the network exist: docker-01v's L3 made both):

```
cd /nvme/stacks/deepslate                      # the checkout, owned by the deploy user (uid 1000)
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
https and nothing private). Not here: the Dockhand mirror of the VPS (dropped, doc 62 §1.5); Dockhand now runs its own copy of this file. Roll back: `sudo IMAGE_TAG=<commit sha>
deploy/home/deploy.sh`.
Logs: `docker logs -f deepslate-web`. The Discord bot runs in `api`: exactly one live api, so the VPS's api is stopped
before this one starts (the cutover, doc 62 §5.5).
