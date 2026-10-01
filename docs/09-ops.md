# 09 · Deployment, security, operations

## VPS layout

```
/home/ladm/Minecraft-site/            git checkout of this repo (owned by ladm)
/home/ladm/Minecraft-site/deploy/.env
/home/ladm/Minecraft-site/deploy/wireguard/wg_confs/wg0.conf   git-ignored
/home/ladm/Minecraft-site/deploy/keys/deploy.key               git-ignored, mounted read-only into api
/home/ladm/Minecraft-site/data/branding/, data/news/            git-ignored: uploaded logo, banner, tab icon; news pictures
/home/ladm/Minecraft-site/data/screenshots/                     git-ignored: pictures taken while testing
/home/ladm/Minecraft-site/dist/                                 git-ignored: what a modpack build makes; owner uid 1000
/home/ladm/.config/deepslate/git-credentials                    ladm's, mode 600: the token git uses for GitHub
/root/docker/deepslate/postgres, /root/docker/deepslate/backups  the database; its nightly dumps (seven kept), the dumps taken
                                                                 before each migration, the old world of 2026-09-29
/data/stacks/deepslate/                                         Dockhand's mirror of the stack (made by deploy.sh)
/root/.config/deepslate/                                        root only: helper and test scripts of the building sessions
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
                   git pull --ff-only (as the checkout's owner)  →  docker compose pull web api
                   →  ownership of dist/, deploy/keys, deploy/wireguard put right; data/branding, data/news made
                   →  docker compose up -d --remove-orphans  →  Dockhand's mirror refreshed
                   →  docker image prune -f  →  waits for web to be healthy, prints /api/health
```

**Before a push: `deploy/check.sh`** (typecheck, lint, tests; `deploy/check.sh api test` for one package and one step). The VPS has no Node: it runs them in a throwaway `node:22-alpine` container capped at 1.5 GB, as the checkout's owner, and will not start with under 1.2 GB available or while another check runs.

**git on the VPS runs as `ladm`, the network too**: `runuser -u ladm -- git pull --rebase`, `… git push`. The credential helper keeps the token in `/home/ladm/.config/deepslate/git-credentials` and rewrites that file when it has been used; a `git fetch` or `git push` as root leaves it root's, and the next `deploy.sh` stops at "could not read Username" (2026-09-29). The cure is `chown ladm:ladm` on that one file.

**Before a migration**: `docker exec deepslate-db pg_dump -U deepslate -d deepslate | gzip > /root/docker/deepslate/backups/pre-00NN-<name>.sql.gz`.

- `deploy/deploy.sh` refuses to run without swap, with under 600 MB available, without `GHCR_OWNER` in `deploy/.env`, or with a `DEEPSLATE_DIR` there that is not this checkout; it waits for `deepslate-web` to report healthy and prints the health JSON.
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

`modpack build` (jar downloads, the settings zip, the installer zip) runs inside `api`: Admin → Modpack → Build calls `POST /modpack/build` and streams the output line by line. Jars are streamed to disk and hashed in chunks, never held in memory. Measured 2026-09-29 with 11 jars, 17.8 MB: peak 75 MB. (The pack is 25 jars for the server since; not measured again, and no build has come near the limit.) `dist/` belongs to uid 1000 (api writes, web reads; `deploy.sh` sets the owner). Do not run the CLI's `build` in a one-off container on the host.

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

The map host also sends `Content-Security-Policy: frame-ancestors https://deepslate.dsw.test` (added 2026-09-29), so only the portal can show the map inside a page; the full block is in `deploy/Caddyfile.snippet`. Reload recipe in `deploy/README.md`. BlueMap has been in the pack since Phase 3; the map host answers 502 only while the game server is asleep or stopped, because BlueMap runs inside it.

## `.env.example`

See `deploy/.env.example` (kept current; every variable commented). Notables: `API_URL`/`API_SERVICE_TOKEN` (web → api), `AMP_URL=http://10.77.0.2:8080`, `AMP_INSTANCE_ID`, `AMP_TUNNEL_IP=10.77.0.2`, `RSYNC_TARGET=amp@10.77.0.2:`, `COOKIE_DOMAIN=.deepslate.dsw.test`, `MAP_URL=https://map.deepslate.dsw.test`, `DISCORD_GUILD_ID` and `DISCORD_GUILD_AUTO_JOIN` (the Discord server as the invite), `DEEPSLATE_DIR` (the checkout, absolute; `deploy.sh` checks it), `GHCR_OWNER`, `IMAGE_TAG`, `SERVER_ADDRESS`, `MANIFEST_KEY` (the mod list without a sign-in, for admins' own tools), `MODRINTH_USER_AGENT`, `LIMBO_POS` (the entrance room: `deepslate:limbo 0.5 65 0.5`) and `SPAWN_POS` (where somebody is let in who has never been in the world: `0.5 105 0.5`). Read by `api` and not in the example: `DISCORD_BOT_TOKEN` (optional, docs/04), `GEOIP_DB`. No `AMP_INSTANCE_DIR`.

## Security checklist

- VPS firewall (`/usr/local/sbin/host-firewall.sh`): 80/443 (Caddy), UDP 51820 (WireGuard, any source; unauthenticated packets are dropped by WireGuard), SSH rule unchanged. Game and voice ports are the homelab's business (mc-router, docs/17), not the VPS's. AMP's web UI and BlueMap are reachable only over the tunnel.
- Keys in `deploy/wireguard/` and `deploy/keys/` are git-ignored; the VPS host has no route into the tunnel, only the tunnel namespace does.
- AMP `webapp` user: a user of the one instance, with a dozen permissions (docs/08 "What `webapp` may do"): no deleting, no restoring, no setting but sleep mode. Rotate the password if it ever leaks into a log.
- Players never see raw console lines; admins do.
- Everything that ends up in a console command is checked against a strict pattern or a list, in one file (`apps/api/src/actions/registry.ts`). There is no path from free text to a command, for players or for admins, except `server.say`, which says it in chat.
- CSRF: Auth.js handles its routes; app POSTs use same-site cookies + origin check in middleware.
- Dependencies pinned by the lockfile. CI runs lint, typecheck and tests; it does not run `pnpm audit`.
- Backups: Postgres `pg_dump` nightly to `/root/docker/deepslate/backups` (7 kept) by the `backups` container. The world: AMP's backup tool, by hand from Admin → Server ("Back up") or in AMP; whether AMP takes one every night is set in AMP and not known here. Restoring either is in "Runbook" below.

## Observability

- App logs to stdout (JSON in prod), `docker compose logs web`.
- `/api/health` returns 200 with db + AMP reachability. Uptime Kuma on the homelab watches the game servers (docs/17); whether it watches this is for Alex to say.
- Every AMP call logged with duration; slow (>2 s) calls warned.
- `ServerSnapshot` doubles as a poor man's metrics store: thinned after 48 hours, kept 30 days.
- The event log (Admin → Events) has what the portal did and what the server said; the server's console is on Admin → Server.

## Runbook

- **No admin can sign in** (Discord down or gone, password sign-in lost or never set up). On the VPS:
  `docker exec -it deepslate-api pnpm admin:reset-auth <username>`
  `<username>` is the admin's password sign-in username, or their display name if they never set one up. It switches that admin's authenticator off (password sign-in stays off until it is set up again; the password is not touched) and prints a link, `https://…/login/once/<token>`, that works **once, within 15 minutes**. Open it, press Sign in (a session of 12 hours), and `/me/sign-in` asks for everything again: username, password, authenticator, new recovery codes. Both the reset and the use of the link are in the event log ("One-time sign-in link made from the command line for …"), and the sign-in shows on every admin's pages for 24 hours. Only the token's SHA-256 is stored (`OneTimeLogin`). An admin who still gets in can do the same for another admin more simply: Admin → People → row menu → Turn password sign-in off, then they set it up again.

- **Server won't start after a mod change** → the console on Admin → Server, or `logs/latest.log` in Admin → Files, names the mod. Switch it off in `mods.json` (Admin → Modpack), Lock, Build, Sync, and **Start**: a sync's restart does not start a server that has failed. There is no rollback command; git has every state of `mods.json` and the lock. (2026-09-29, TabTPS: twelve minutes from the failed start to a running server.) **Start the server once with any new server-side mod before building on it.**
- **A player can't connect ("mod mismatch")** → Admin → Installs has their last run and the pack it installed; the pack the server runs is on Admin → Modpack. They press Play on the site, which brings their PC up to date.
- **A player's install fails** → Admin → Installs, the run, its log. Every failure so far was in there in full.
- **Restore the database** → `gunzip -c <dump>.sql.gz | docker exec -i deepslate-db psql -U deepslate -d deepslate` into an emptied database, with `web` and `api` stopped. Not rehearsed.
- Restore world from backup → AMP UI, backups tab, or documented CLI.
- Rotate AMP password → `.env`, then `sudo deploy/deploy.sh`. The password is in `deploy/.env` on the VPS and nowhere else (the copy on the AMP host, `/root/deepslate-webapp.pass`, was removed on 2026-09-29).
- **A new dimension from a datapack** (`modpack/datapacks/`): Build, Sync, then restart the server at a moment of your choosing; Sync does not restart for it. `POST /actions/world.datapacks` lists what is enabled.
- **A new world** (done once, 2026-09-29; 11-status has that day's record). The seed is AMP's to set (`MinecraftModule.Minecraft.WorldSeed`; the portal can read it, not write it), and AMP writes it into `server.properties` when the server starts, not before. With the server **stopped**: copy `world/` away over the rsync link and compare by checksum (`rsync -rltpcn --delete --itemize-changes`, no lines = the same), copy it back up under the new name, compare again, and only then empty `world/` (`rsync -r --delete <an empty folder>/ amp@…:world/`, after a dry run that shows deletions and nothing else). The link cannot rename, and an empty `world/` is as good as none: the game makes a new world in it. Then, through `api`: `POST /server/start`; `POST /actions/world.seed`; Sync (the datapack with the room's dimension lives in the world's folder and has gone with it) and a restart; `POST /actions/limbo.build` (the room is part of the world and goes with it); `POST /actions/map.purge` for `world`, `world_the_nether`, `world_the_end`; `POST /actions/world.pregen {x, z, radius}`. `level.dat` has the spawn (`Data.SpawnX/Y/Z`).
- **The map shows old tiles, or a render that never finishes.** With the server **stopped**, empty the three folders `bluemap/web/maps/world`, `world_the_nether`, `world_the_end` over the rsync link (`rsync -r --delete <an empty folder>/ amp@…:bluemap/web/maps/world/`, after a dry run that shows deletions only): tiles, low resolution and BlueMap's own record of what it has rendered all live there. (`bluemap purge <map>` does the same on a running server, one map at a time.) After the next start BlueMap renders everything that exists; to have that finish, Admin → Server → Pre-generation → *Render the map only*, which keeps the server awake until BlueMap says the map is updated. Done on 2026-09-29 at 16:48:52 UTC and, on Alex's word, again at 18:36:33 UTC. BlueMap's settings need no change for this: `maps/world.conf` has no `min-x`/`max-x`/`min-z`/`max-z`, and BlueMap only renders chunks that exist, so it renders the pre-generated area and what players add to it. Limits of ±1500 would hide everything explored later. The low-resolution tiles are made from the high-resolution ones as those are rendered. `render-thread-count: 1` (`core.conf`).
- **Chunky on a server that sleeps.** AMP puts an empty instance to sleep after five minutes (`MinecraftModule.Limits.SleepDelayMinutes`), pre-generation or not, and a stop in the middle of generating hung the server. Use Admin → Server → Pre-generation: it switches AMP's sleep mode off while it is due and back afterwards (needs `Settings.MinecraftModule.Limits.SleepMode` for `webapp`). Never a loop that wakes the server.
- **The server hangs in "Stopping"** → Admin → Server shows "End the process" while that is so (or `POST /server/kill` on api, admin caller; refused in any other state). What had not been saved is lost. Never used for the pre-generation.
- **After ADS has been restarted** the api's session is gone. Since 2026-09-29 the client notices (AMP answers HTTP 200 with "requires the Session.Exists permission") and logs in again; before, the portal showed "Unknown" until `api` was restarted.
- The box is short of memory → `free -m`, `docker stats --no-stream`, `journalctl -k | grep -i "killed process"`, `journalctl -u earlyoom`. Every container has a limit, so a container that grows is killed inside its own limit; look for something running outside one.
