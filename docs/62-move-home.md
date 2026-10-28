# 62 · Planner decisions · moving the stack home · 2026-10-22

> **Done (2026-10-28).** The cutover ran on 2026-10-23 (docs/11), and since then everything runs at home on docker-01v
> as one Docker Compose stack, `deepslate`, in Dockhand, published through Pangolin, with api reaching the AMP host
> over the LAN. The VPS is no longer used. How to deploy: deploy/home/README.md. The doc edits of §7 were made on
> 2026-10-28 for 00, 02, 09, 28, 42 and the working rules' public copies (README, ROADMAP); 13 and 17 are planner input
> and were left as they are, and 38 got a dated note rather than new entries. Still open: the clean-up of §5 step 6
> (the WireGuard peer on the AMP host, the stopped VPS stack) and the VPS-only files in `deploy/` (deploy/README.md).
> The text below is the plan as decided on 2026-10-22.

Decided, not started. Nothing has changed on any host. Until the cutover (§5 step 5), docs 00, 02, 09, 13, 17, 28 and
42 still describe live as it is. From the cutover on, this doc overrides them where they disagree, and §7 lists the
edits that bring them in line. Brief this is based on: the VPS session's report of 2026-10-22, with the home VM's
read-only check and a reading of the code.

## 1. Decisions

1. **The whole stack moves to `docker-01v`** (Alex, 2026-10-22). That's Alex's home Docker VM, on the same Proxmox
   host as the AMP host (`10.0.10.8`). `api` then reaches AMP, BlueMap, the mc-router dashboard and rrsync over the
   LAN, and the WireGuard tunnel retires.
   - A separate small VM on a DMZ VLAN was offered as the safer place. Alex chose docker-01v.
   - The walls in §2 are what makes that acceptable.
2. **The website is published through Pangolin** (Alex, 2026-10-22). A Cloudflare Tunnel was considered and dropped.
   - Pangolin gets its own site, "deepslate", with **its own `newt`** in the stack, and two HTTP resources:
     `deepslate.dsw.test` and `map.deepslate.dsw.test`, both to the stack's Caddy.
   - **Pangolin's own login is off**: the site signs people in itself, and the Windows app and installer download
     without a browser session.
   - **The working rules' Pangolin line changes now:** "The website is published through Pangolin (docs/62);
     Pangolin is otherwise not this project's." Sessions may prepare and, on Alex's go, make the "deepslate" site and
     its two resources, and nothing else in Pangolin.
3. **Development stays on the VPS.** The development checkout, the sessions, `deploy/check.sh` and pushes to `dev`
   stay where they are.
   - Production on docker-01v only pulls the images CI builds, as the VPS does today.
   - The production checkout there, which the admin UI commits `modpack/mods.json` from, gets its own push credential
     limited to this repository's contents.
   - Revisit once the move has run for a month.
4. **The designer** (`deepslate-designer`, profile `designer`) is off at the cutover. Its CLI and login live on the
   VPS host. It comes back on docker-01v only if Alex asks; until then its pages say it's off.
5. **The Dockhand mirror** (`deploy/dockhand-sync.py`) is dropped at the cutover. The repo is the truth, and docker-01v's
   Dockhand shows the containers anyway.
   - Until then it fails harmlessly. Dockhand moved to docker-01v on 2026-10-22, and `DOCKHAND_URL` still names its old
     address, so `deploy.sh` prints "Dockhand mirror NOT updated (the deploy itself is fine)".
   - Repointing it is a `deploy/.env` change, made only on Alex's go, once Dockhand's new address is settled: its
     tailnet address, after docker-01v's session takes its port off the LAN. It's not needed for the move.
6. **Uptime Kuma** checks `/api/health` through Pangolin (from outside), and the game as now. Set by Alex or the Kuma
   session at the cutover.
7. **The window** is quiet and agreed with Alex: nobody online, and not during a season event, a world refill or a
   pre-generation (docs/47 §5).

## 2. Layout after the cutover

```
Internet → 203.0.113.10:443 (UniFi forward, as today) → Pangolin (TLS for deepslate.dsw.test, map.deepslate.dsw.test)
        → deepslate-newt (own site, no Docker socket)                         network ds-edge
        → deepslate-caddy :80 (forward_auth for the map; sets the client IP)  networks ds-edge, ds-web
        → deepslate-web :3000                                                 networks ds-web, ds-internal
        → map: caddy → deepslate-map-relay (socat) → BlueMap 10.0.10.8:8100    relay on ds-web and ds-amp
deepslate-web → deepslate-api :4000 (service token, as now)                   ds-internal
deepslate-api → 10.0.10.8: 8080, 8100, 8090, 22; Discord, Modrinth, GitHub   ds-internal, ds-amp
deepslate-db, deepslate-backups                                               ds-internal (internal: true)
```

**The boundary of docs/02, kept by new means** (docker-01v sits on a flat LAN with Proxmox, the gateway and the NAS):
- **DOCKER-USER rules on docker-01v**, from a script started at boot, like the VPS's `host-firewall.sh`:
  - `ds-edge` and `ds-web` reach nothing in 10.0.0.0/8, 172.16.0.0/12 (outside their own networks), 192.168.0.0/16
    or 100.64.0.0/10 (the tailnet).
  - `ds-edge` reaches only newt's tunnel endpoint: Pangolin's public name on tcp 443 (control), udp 51820 (tunnel)
    and udp 21820 (relay). It goes through the router's hairpin NAT, which already works for docker-01v's own newt.
    Match public addresses on those ports rather than one IP, since the home IP may change.
  - `ds-web` may also reach public addresses on tcp 443: `deepslate-web` fetches Authentik's keys and tokens by its
    public name, through the same hairpin NAT.
  - `ds-amp` reaches `10.0.10.8` on tcp 8080, 8100, 8090 and 22 and the internet, and nothing else on the LAN or
    tailnet.
  - `ds-internal` has no outside access (`internal: true`).
- **No Deepslate container mounts the Docker socket. No published ports** (docker-01v's house rule).
- **The AMP host's nftables:** 8090 and 8100 from docker-01v only; 8080 and 22 as they are. The `10.77.0.1` rules go
  in the clean-up.

## 3. What the code requires (read 2026-10-22)

1. **Long responses.** Every hop (Pangolin's Traefik, newt, Caddy) must let a response run 20 minutes and stay silent
   for most of it, and must not buffer `text/event-stream`. Caddy does this by default.
   - Pangolin, checked 2026-10-22: no `writeTimeout`; `readTimeout` 30m (request side only); no forwarding timeouts; no
     compress or buffering middleware; `flushInterval` 100 ms.
   - Not checked: whether newt drops a silent stream. So the builder makes the admin modpack route send an SSE comment
     (`: ping`) every 15 s while it waits on api.
   - Admin → Modpack → Build is one Server-Sent Events response (`maxDuration` 600). web waits on api's NDJSON stream
     for up to 960 s.
   - Sync is one response, silent until rsync and the restart finish: up to 900 s, then up to 420 s of verify.
2. **The visitor's address.** `clientIp()` (`apps/web/src/server/auth/request.ts`) takes the first `X-Forwarded-For`
   entry. It feeds sign-in records and throttling, and the invite and launcher limits.
   - Caddy trusts only `ds-edge` (`trusted_proxies` plus `trusted_proxies_strict`) and passes on one value,
     `header_up X-Forwarded-For {client_ip}`.
   - Pangolin's Traefik must replace, not trust, a visitor's own `X-Forwarded-For`. Checked 2026-10-22: all
     entrypoints have `forwardedHeaders: {}`. A forged `X-Forwarded-For` and `X-Real-Ip` were dropped and replaced.
   - Visitors on the home LAN arrive through hairpin NAT as the router's address, so they share one rate-limit bucket.
     That's acceptable.
   - The dry run proves the whole chain with a forged header.
   - Game-session countries come from mc-router (docs/02) and are unaffected.
3. **Uploads** stay far below any limit: branding 2 MB, news pictures 3 MB, build imports 8 MB, server actions 26 MB,
   Caddy 50 MB.
4. **The Discord bot is in `api`.** Exactly one live `api` may run: the cutover stops the VPS's first. The test `api`
   is silent on Discord (no `DISCORD_TALKS`, docs/42a).
5. **Pangolin's CrowdSec must not ban map users or the app.** Every Pangolin resource carries `crowdsec@file`, in live
   mode, and its http scenarios end in a 4-hour captcha on every Pangolin host. The Windows app can't answer a captcha,
   so a ban on a player's address also stops their app.
   - `http-crawl-non_statics` fires when one address fetches about 40 distinct non-static paths in about 20 s.
     Static means images, css/js, fonts, media, `.gz` and `.tgz`.
   - `http-probing` fires at 10 distinct 403/404/400 paths.
   - **The app is safe:** mods come from Modrinth's CDN; from the portal it fetches only the manifest, config, a few
     private jars, its update and `.png` heads.
   - **The map is not:** BlueMap 5.7's web view fetches hi-res tiles as separate files while you pan, and those
     aren't static by that list. The map also polls its live markers.
   - **Requirement before the dry run:** the two Deepslate hosts are exempt from CrowdSec's http scenarios.
   - **How** (the Pangolin session's proposal, 2026-10-22): a parser whitelist on `evt.Meta.target_fqdn` for the two
     hosts, on access-log lines only, so AppSec still runs. Routers without the middleware aren't possible:
     `crowdsec@file` sits on the entrypoint. The same field fixed Pangolin's other host whitelist that evening, which
     had never matched.
   - It goes in once the resources exist. Proof: `cscli explain` says "ignored by whitelist", and 100 distinct paths
     from one public address leave no decision. The dry run also pans the map hard and checks no decision appears.
   - The site's own sign-in throttling and rate limits stay as they are.
6. **The live compose keeps working until the cutover.** The home stack's compose lives apart (e.g.
   `deploy/home/docker-compose.yml`), and the swap is part of the cutover, so a deploy to the VPS meanwhile is
   unaffected.

## 4. Blockers

All five must be true before §5 step 3. On 2026-10-22, 21:00 UTC: 1, 2 and 5 are done, 3 is open,
and 4 waits until about 2026-11-05. The shared status board (outside the repository) tracks them.

1. **The GitHub self-hosted runner on docker-01v cannot take jobs from public repositories.** This repository is public;
   its own six workflows are all on GitHub-hosted runners (checked 2026-10-22).
   - docker-01v's session found the runner in the organisation's Default group, reached with `runs-on: deploy`.
   - Only private repositories reference it, and its logs show six jobs, all from private ones.
   - Whether the group allows public repositories couldn't be read: the CLI token lacks `admin:org`.
   - **Done 2026-10-22, 21:00 UTC:** the Default group already had public repositories off, and on Alex's go its
     repository access was narrowed to the five private repositories that use the runner.
2. **The mc-router dashboard (AMP host, 8090) is no longer open to the LAN.** It was open with no login on 2026-10-22,
   showing players' addresses and accepting route changes.
   - **Done 2026-10-22** by the AMP host session, on Alex's yes. The LAN accept for 8090 is gone from the dashboard's
     nftables table, which a unit loads at boot. 8090 now accepts only `10.77.0.1` on `wg0`, and loopback.
   - Proven: docker-01v can't connect. `api` still reads the router's logins every 2 minutes (`ROUTER_DASH_URL`, for
     where sessions came from) and has logged no failure since.
   - The move-day rule of §2 (8090 and 8100 from docker-01v) goes in only at the cutover.
3. **An offsite copy of the dumps is confirmed.** docker-01v's Duplicati destination isn't confirmed offsite.
   - The nightly dump stays, and so does `api`'s copy into the instance's `_backup/db/` (docs/28), which now runs over
     the LAN.
   - The VPS's Duplicati-to-B2 copy stops being the safety net at the cutover.
   - docker-01v's Duplicati covers `/data`, where `/data/appdata/deepslate` will live. Its destination needs root or
     Duplicati's own page to read: Alex and the docker-01v session check it.
4. **docker-01v's consolidation has settled.** It was cut over on 2026-10-22, and the old VMs are kept two weeks. Check
   its swap afterwards (3.1 of 4 GiB in use on 2026-10-22, 2.9 that evening).
5. **Sign-in is settled** (checked read-only on 2026-10-22).
   - Live runs `main` at the merge of PR #90 with all three `AUTHENTIK_*` settings on. Its sign-in page offers
     "Discord or Microsoft" through Authentik, plus the admin password and the one-time link. The site's own Discord
     sign-in is off (`DISCORD_DIRECT_LOGIN` empty). The test site uses the same three settings.
   - The `deepslate` provider is on the home Authentik, reached by its public name through Pangolin (that name resolves
     to Pangolin's address), not on the VPS. The VPS runs only an Authentik proxy outpost, which Deepslate doesn't use.
   - Both web containers fetch its discovery document today. After the move `deepslate-web` reaches it the same way,
     through the router's hairpin NAT (§2).
   - A new test name needs its redirect address (`<name>/api/auth/callback/authentik`) on that provider; the live name
     keeps the one it has. Discord needs nothing while the site's own Discord sign-in stays off.
   - docs/11's section of 2026-10-20 still says "not on `main`, not deployed": the next session corrects it.

## 5. Order of work

0. **Now:** blocker 1 (Alex) and blocker 3; blocker 2 is done. Alongside, not this project's but on the same hosts:
   Dockhand's LAN port and Traefik's trust range on docker-01v (the trust range is done), and on Pangolin-01V its
   Traefik API (done), a secret rotation and two CrowdSec ports. Nothing of the move itself starts.
1. **On `dev`, by a builder session:**
   - the home compose (networks and services as §2: drop `wireguard` and both relays; add `deepslate-caddy`,
     `deepslate-newt` and one map relay, no Docker socket);
   - the home `.env.example` (placeholders only; `AMP_URL`, `RSYNC_TARGET`, `ROUTER_DASH_URL` and the map relay's
     target on the LAN; `AMP_TUNNEL_IP` retired);
   - `/health`'s `tunnel` becomes a LAN check;
   - the admin modpack route sends an SSE comment every 15 s while waiting (§3.1);
   - `deploy.sh` and `check.sh` for the home paths (`/data/stacks/deepslate`, `/data/appdata/deepslate/…`), still
     pull-only, memory caps as now;
   - `geoipupdate` in the home stack.
   - CI unchanged.
2. **docker-01v**, by its session on Alex's go: the DOCKER-USER script, the folders, and the offsite copy (blocker 3).
3. **Pangolin**, on Alex's go:
   - the "deepslate" site and the two resources on a test name first;
   - Pangolin's login off;
   - the CrowdSec exemption of §3.5.
   - The timeout and forwarded-header checks of §3 were done on 2026-10-22 and passed.
4. **Dry run on docker-01v** against the test instance `DeepslateTest01`, with a copy of the live database. It passes
   only when all of these work:
   - sign-in through Authentik (Discord and Microsoft);
   - the map behind its login;
   - downloads of the app and installer;
   - console;
   - a full build and a sync (long responses);
   - the visitor's address under a forged header;
   - panning the map hard from one address leaves no CrowdSec decision;
   - the nightly dump and a restore;
   - from inside `deepslate-web`, no LAN or tailnet address answers.
5. **Cutover**, in the window of §1.7:
   1. Announce.
   2. Stop the VPS `api`, which also stops the bot and any writes.
   3. Final dump, then restore on docker-01v.
   4. Copy `data/` and `dist/`.
   5. Start the home stack.
   6. Move the two Pangolin resources to the live names and repoint DNS (DNS only).
   7. Check `/api/health`, sign-in, the map, the app's download, and that **one** bot is online.
6. **Two weeks of rollback window, then clean-up:**
   - remove the WireGuard peer on the AMP host, `deepslate-wg` and udp 51820 on the VPS, and the VPS stack;
   - Uptime Kuma;
   - the doc edits of §7.

## 6. Rollback

- At any point up to the clean-up: DNS back to the saved VPS records, stop the home stack, start the VPS stack.
- If anything was written at home after the cutover, dump the home database and restore it on the VPS first.
- The VPS stack, its data and its WireGuard stay intact, stopped, for two weeks after the cutover.

## 7. Doc and rule edits

One commit at the clean-up: `docs: apply planner decisions 62`. The Pangolin line is the exception: it changes now.

- **00:** the portal runs on a home Docker VM next to AMP and reaches it over the LAN; principle 5 reads "one Docker
  host, one compose file, one reverse proxy".
- **02:**
  - the components drawing and table as §2;
  - the security boundary as §2 (Docker networks and DOCKER-USER, not a tunnel namespace);
  - the map in one relay;
  - Environments: prod is docker-01v.
- **09:** deploy and checks on docker-01v (pull-only stays); the VPS paths go; the Dockhand mirror goes.
- **13:** §2–§3 marked as superseded by 62 (tunnel, 51820, `10.77.0.0/24`).
- **17:** the portal is published through Pangolin (62); the rest stands.
- **28:** where the dump and its offsite copy now live.
- **38:** new entries: the flat LAN and its compensating rules; the self-hosted runner on the same VM; Docker-socket
  containers on the same VM.
- **42:** the test copy on docker-01v, started only for tests.
- **The working rules:**
  - the Pangolin line as §1.2 (now);
  - "AMP … reached over the WireGuard tunnel" → over the LAN from docker-01v;
  - the stack's paths;
  - "On the VPS, every git command runs as `ladm`" stays for the development checkout, with the production checkout's
    user named alongside it;
  - "Never build images on the VPS" → on any host of this project.

## 8. Done means

- `deepslate.dsw.test` and `map.deepslate.dsw.test` are served from docker-01v through Pangolin, with `/api/health`
  green. Sign-in, the map, downloads, builds and syncs all work, and one bot is online.
- From `deepslate-web`, no LAN or tailnet address answers. The AMP host lets docker-01v alone reach 8090 and 8100.
- A dump from the last 24 hours exists offsite.
- The tunnel, `deepslate-wg`, udp 51820 and the VPS stack are gone, and the docs in §7 are updated.

## 9. Who does what

| Part | Who |
|---|---|
| AMP host nftables (8090 done 2026-10-22; 8090 and 8100 at the move) | AMP host session, from Alex's paste |
| Runner group (blocker 1) | Alex, as organisation admin; docker-01v session reads it |
| DOCKER-USER script, folders, offsite copy, Dockhand port (Traefik trust range done 2026-10-22) | docker-01v session, on Alex's go |
| Pangolin site, resources and the CrowdSec exemption (timeout and header checks done, exemption method chosen 2026-10-22) | Pangolin session, on Alex's go |
| Home compose, env, deploy and check scripts, dry run, cutover | a builder session, on `dev` |
| docs/11 correction (PR #90 is live) and the §7 edits | builder sessions; the §7 commit at the clean-up |
