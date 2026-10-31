# Deploying on docker-01v (the home stack, planner doc 62)

**One way:** Redeploy of the stack `deepslate` in Dockhand (Docker-01V). Since 2026-10-28 there is no deploy script
here: `deploy.sh` and `test-up.sh` were retired once a redeploy did everything they did. The VPS is no longer used
(cutover 2026-10-23); its files were removed on 2026-10-28 (git history keeps them).

**The live stack is Dockhand's own copy:** Dockhand keeps the compose file and the `.env` (the only copy of the
secrets) in its own data folder, where they are edited and redeployed. The checkout stays clean, so `repo-sync` can
always move it. This folder's `docker-compose.yml` and `.env.example` are the reference: a change to them reaches the
live stack only when it is pasted into Dockhand.

## What a redeploy does

Every image is pulled (`IMAGE_TAG`, normally `latest`: main's newest), then one-shot steps run before the site starts.
Each exits when done. A few minutes after the last one, the host's `deepslate-step-cleanup` timer (below) saves their
logs to `DEEPSLATE_DATA/deploy-logs/redeploy-<UTC start>.log` (newest 10 kept) and removes the finished containers, so
the stack shows only what runs. A step that failed is left in place with all the others: `docker compose ps -a` lists
them and `docker logs deepslate-<step>` says what it did.

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

Roll back: `IMAGE_TAG=<commit sha>` in Dockhand's `.env`, pull that web and api, then redeploy. A migration has no way
back but the `pre-deploy-*` dump before it.

The checkout follows `main` (what is deployed); `repo-sync` refuses any other branch but `dev`. The test pair follows
`TEST_IMAGE_TAG` (normally `dev`): pull `deepslate-web:dev` and `deepslate-api:dev` in Dockhand, then redeploy.

## What is in this folder

| File | What it is |
|---|---|
| `docker-compose.yml` | The home stack: the one-shot steps (init, repo-sync, installer, db-prep, migrate), the site's newt, postgres, caddy, web, api, one map relay, backups, geoipupdate (profile `geoip`), the test pair (profile `test`) and the designer (profile `designer`). Four networks named for the host's firewall: `ds-edge` (made once before the stack, so it outlives a `compose down`), `ds-web`, `ds-amp`, `ds-internal` |
| `Caddyfile` | The stack's own Caddy on :80 behind the newt: the site, the map (login enforced by the portal) and the test site, host names from `.env`; trusts forwarded headers from `ds-edge` only and passes one `X-Forwarded-For` on |
| `.env.example` | Every variable the home stack reads: the template for the stack's `.env` in Dockhand. Replace every `replace-me-...` and all-zero id |
| `check.sh` | Runs the repo's checks from this folder (`../check.sh`) |
| `step-cleanup.sh`, `systemd/` | The host's step cleanup (below): after a redeploy, the steps' logs to a file and their containers removed. `DRY_RUN=1 LOG_DIR=/tmp/x ./step-cleanup.sh` writes the file and removes nothing |
| `../images/` | The stack's own images, built by CI: `db`, `backups`, `caddy`, `designer`, `ops` (init and repo-sync), `installer` |

What runs apart: the host's `deepslate-firewall` service, which gates the four networks by bridge name, and the
`deepslate-step-cleanup` timer, which tidies up after a redeploy from outside the stack (the stack has no Docker socket).
Every two minutes, as uid 1000 (in the docker group), it looks at the project's containers whose restart policy is
"no": once all have exited with 0 and the last ended three minutes ago, it writes their logs to one file and removes
them. Installed once, as root, from this folder:

```
install -m 755 step-cleanup.sh /usr/local/sbin/deepslate-step-cleanup.sh
install -m 644 systemd/deepslate-step-cleanup.service systemd/deepslate-step-cleanup.timer /etc/systemd/system/
install -d -o 1000 -g 1000 /nvme/appdata/deepslate/deploy-logs
systemctl daemon-reload && systemctl enable --now deepslate-step-cleanup.timer
```

`journalctl -u deepslate-step-cleanup` says what each run did. A new version of the script is installed the same way.

The newt
(`deepslate-newt`, the service `newt`) is Pangolin's tunnel client for the site `deepslate`: its id and secret are
`NEWT_ID` and `NEWT_SECRET` in `.env`, with the stack's other secrets. Until 2026-10-23 it ran as a stack of its own
under Dockhand; now the one stack starts, updates and stops everything the site needs.

## Where things live

- `DEEPSLATE_DIR` (`/nvme/stacks/deepslate`): this checkout. `web` mounts `modpack/` and `.git` (Admin → Lock commits
  there), `api` mounts `modpack/`, `installer/` and `deploy/keys` (the rrsync key, uid 1000, plus `known_hosts`).
- `DEEPSLATE_DATA` (`/nvme/appdata/deepslate`): `postgres/` (70:70, 700), `backups/` (70:70, the nightly dumps),
  `dist/` and `data/` (uid 1000: built packs, uploaded pictures, builds, private jars), `geoip/`, `caddy/`.
  The `init` step makes them with those owners.
- Both roots are on docker-01v's `/nvme` disk since 2026-10-28 (the test checkout too, `/nvme/stacks/deepslate-test`).
  `/data` is kept for media downloads, so a full download disk no longer stops the site.
- The AMP host is reached on the LAN: `AMP_HOST`, `AMP_URL`, `ROUTER_DASH_URL`, `RSYNC_TARGET` in `.env`. The AMP host
  admits this host alone on 8090 and 8100 (its nftables), and the rrsync key's `from=` names this host.
- `/api/health` keeps its `tunnel` field: at home it is a TCP check of the AMP host's sshd over the LAN.

First time (after the folders and the network exist: docker-01v's L3 made both):

```
git clone <repo> /nvme/stacks/deepslate      # the checkout, owned by the deploy user (uid 1000), following origin/main
```

Then in Dockhand: a new stack `deepslate` with this folder's `docker-compose.yml`, and as its `.env` the
`.env.example` filled in (the newt's id and secret from Pangolin → Sites → deepslate); the GitHub registry login; pull
the private images; Deploy.

The `.git/config` and `.git/hooks` guards are the VPS's (`deploy/README.md`): make `/root/.config/deepslate/git-config.expected`
and `git-hooks.expected` once, as root, after reading both by eye.

Pangolin: three HTTP resources on the site `deepslate`, `SITE_HOST`, `MAP_HOST` and `TEST_HOST`, all to
`deepslate-caddy:80`, Pangolin's own login off, CrowdSec's http scenarios bypassed for the hosts. Authentik: the
provider's redirect URIs for `AUTH_URL` and `TEST_AUTH_URL`.

Since 2026-10-23 everything the VPS ran is here, in the one stack: the test pair (`TEST_STACK=1`; its checkout at
`TEST_DIR`, on dev, brought forward by `repo-sync-test`) and the designer (`DESIGNER_CMD`
set; its host user `designer`, uid 1010, with the CLI installed and signed in, docs/39; on `ds-web`, so it reaches public
https and nothing private). Not here: the Dockhand mirror of the VPS (dropped, doc 62 §1.5); Dockhand runs its own copy of this file.
Logs: `docker logs -f deepslate-web`. The Discord bot runs in `api`: exactly one live api, so the VPS's api is stopped
before this one starts (the cutover, doc 62 §5.5).
