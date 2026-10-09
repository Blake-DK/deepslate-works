# 13 · Planner decisions · 2026-09-28 (late)

Supersedes the domain, tunnel-exposure and AMP-addressing parts of `docs/12-planner-update.md`. Answers the VPS session's six review points and folds in the AMP host session's report. Read 11-status.md, then 12, then this. Where 12 and 13 disagree, 13 wins.

## 1. Domain (overrides 12 §1)

- Portal stays **`deepslate.dsw.test`**. No re-domain step.
- Map host: **`map.deepslate.dsw.test`**. Alex adds one DNS A record → `198.51.100.20` (the wildcard doesn't cover a nested name).
- `COOKIE_DOMAIN=.deepslate.dsw.test` so the session covers both hosts and nothing else on dsw.test.
- Discord redirect: `https://deepslate.dsw.test/api/auth/callback/discord`.
- Replace `portal.dsw.test` with `deepslate.dsw.test` and `map.dsw.test` with `map.deepslate.dsw.test` everywhere in docs 04/09/12.

## 2. Answers to the six review points

| # | Point | Decision |
|---|---|---|
| 1 | Cookie scope too broad | Agreed. `.deepslate.dsw.test`, as above. |
| 2 | UDP 51820 dropped by host firewall | Add it to `/usr/local/sbin/host-firewall.sh` for both the INPUT and DOCKER-USER forwarding chains as part of step 3. Source **any**: WireGuard drops unauthenticated packets and the home IP (`203.0.113.10`) is dynamic. |
| 3 | API reachable from the whole `web` network | Don't put the tunnel namespace on `web` at all. See §3. `api:4000` ends up reachable only from `internal`. Bearer token stays as the second layer. State this in docs/02. |
| 4 | AMP host guide missing | Not needed on the VPS. It lives with the planner and has already been run on the AMP host. Its results are in §4. |
| 5 | Locking SSH to a dynamic home IP | Don't. Leave the SSH rule exactly as it is today. Only 51820 changes. |
| 6 | Invite re-issue, Caddy `common` import | Accepted: no re-issue; Caddy blocks `import common` like every other site here; drop the hand-written headers from 12 §5. |

On the cost of the split: accepted. Two services, one service token, server routes mirrored once. That is the price of "internet-facing code has no route to the house". the working rules's "no microservices" line means "no more than this"; add that sentence to the working rules.

## 3. Tunnel and relay layout (overrides 12 §3 and §5)

```
Caddy (web) ──> map-relay-outer (web + internal) ──> deepslate-wg:8100 (internal)
                                                      └─ tunnel namespace: wireguard + api + map-relay-inner
                                                                              └─> 10.77.0.2:8100 (BlueMap on the AMP host)
web (internal) ──> deepslate-wg:4000 (api, bearer token)
```

`deploy/docker-compose.yml`:

```yaml
services:
  wireguard:
    image: lscr.io/linuxserver/wireguard:latest
    container_name: deepslate-wg
    cap_add: [NET_ADMIN]
    sysctls: { net.ipv4.conf.all.src_valid_mark: 1 }
    volumes: [./wireguard:/config]          # wg_confs/wg0.conf, git-ignored
    ports: ["51820:51820/udp"]
    networks: [internal]                    # NOT on web
    healthcheck:
      test: ["CMD", "ping", "-c1", "-W2", "10.77.0.2"]
      interval: 30s
      timeout: 5s
      retries: 3
    restart: unless-stopped

  api:
    build: { context: .., dockerfile: apps/api/Dockerfile }
    container_name: deepslate-api
    network_mode: "service:wireguard"       # reachable as deepslate-wg:4000 on internal only
    env_file: .env
    depends_on: [wireguard, postgres]
    restart: unless-stopped

  map-relay-inner:
    image: alpine/socat:latest
    container_name: deepslate-map-relay-inner
    network_mode: "service:wireguard"
    command: TCP-LISTEN:8100,fork,reuseaddr TCP:10.77.0.2:8100
    depends_on: [wireguard]
    restart: unless-stopped

  map-relay-outer:
    image: alpine/socat:latest
    container_name: deepslate-map-relay-outer
    networks: [web, internal]
    command: TCP-LISTEN:8100,fork,reuseaddr TCP:deepslate-wg:8100
    depends_on: [map-relay-inner]
    restart: unless-stopped
```

`deploy/wireguard/wg_confs/wg0.conf` (git-ignored; commit `wg0.conf.example`):

```
[Interface]
Address = 10.77.0.1/24
ListenPort = 51820
PrivateKey = <vps private key>

[Peer]
# AMP host (homelab). It initiates; no Endpoint here.
PublicKey = D/ZFt5fGUd+8tLvS+9TbSZ7ZB0SLwmqPBsBEBjOiNg4=
AllowedIPs = 10.77.0.2/32
```

Caddy (in the existing `web-proxy` Caddyfile):

```
deepslate.dsw.test {
  import common
  reverse_proxy deepslate-web:3000
}

map.deepslate.dsw.test {
  import common
  forward_auth deepslate-web:3000 {
    uri /api/auth/verify
  }
  reverse_proxy deepslate-map-relay-outer:8100
  handle_errors {
    @unauth expression {http.error.status_code} == 401
    redir @unauth https://deepslate.dsw.test/login?next=https://map.deepslate.dsw.test{uri}
  }
}
```

The map block can go in now; it 502s harmlessly until BlueMap exists (Phase 3). `web` must not be given a route to `10.77.0.0/24`; it reaches AMP only through `api`. Recreating `wireguard` requires recreating `api` and `map-relay-inner` (shared namespace).

## 4. AMP host: what exists and how we address it (overrides 12 §2 item 1 and the "instance port" language in 02/08/09/12)

Report from the AMP host session (2026-09-28):

- Ubuntu 26.04, AMP at `/opt/cubecoders/amp`, runs as `amp` (uid 1001, home `/home/amp`).
- WireGuard peer prepared at **10.77.0.2**, public key **`D/ZFt5fGUd+8tLvS+9TbSZ7ZB0SLwmqPBsBEBjOiNg4=`**. `wg0.conf` written, waiting for our public key before `wg-quick@wg0` is enabled. Homelab initiates; nothing is opened inbound at home.
- Its firewall (nft table `inet deepslate`, loaded by a oneshot unit) allows from `10.77.0.1` on `wg0`: tcp `{22, 8080, 8100}`, icmp echo, established; drops everything else on `wg0`. LAN untouched.
- `rrsync` at `/usr/bin/rrsync`. `authorized_keys` for `amp` has a commented placeholder waiting for our `deploy.pub`: `command="/usr/bin/rrsync <instance>/Minecraft",restrict,from="10.77.0.1" ssh-ed25519 <key> deploy@portal`. sshd password auth is off for `10.77.0.1` via a `Match Address` block.
- **The Deepslate Works instance does not exist yet.** Alex is creating it as `DeepslateWorks01` (Minecraft Java, NeoForge, 1.21.1, Java 21, 6 to 8 GB). Instance dir will be `/home/amp/.ampdata/instances/DeepslateWorks01/Minecraft`.
- Every AMP instance on that box binds its own API to `127.0.0.1`; only the ADS on **8080** is on `0.0.0.0`.

**Decision: talk to the ADS, not the instance.**

- `AMP_URL=http://10.77.0.2:8080`
- New env `AMP_INSTANCE_ID=<from Alex once the instance exists>`; drop `AMP_INSTANCE_DIR`.
- Every instance call goes through `/API/ADSModule/Servers/<AMP_INSTANCE_ID>/API/<Module>/<Method>` with the same JSON body and `SESSIONID` as a direct call. Login is `POST /API/Core/Login` against the ADS.
- `webapp` is an **ADS-level** user with rights only on `DeepslateWorks01` (login, console read/write, player list, start/stop/restart, file manager read). Password → `deploy/.env`.
- Verify the real method names and shapes against the ADS's `/API` listing once the tunnel is up and record them in docs/08 "AMP methods used". Until then `AMP_MOCK=1`.
- `api` `/health`: `tunnel` = ping `10.77.0.2`; `amp` = `Core.GetAPISpec` through the proxy; `rsync` = `ssh -i deploy.key amp@10.77.0.2 true` returns non-zero with an rrsync message (expected: the key can't run commands) rather than a connection error.
- `sync-server` = `rsync -e "ssh -i /run/keys/deploy.key" --delete dist/server/mods/ amp@10.77.0.2:mods/` plus config/BlueMap dirs (rrsync roots at the instance's `Minecraft/`), then `Core.Restart` through the proxy if `mods/` changed. Deploy key mounted read-only from `deploy/keys/` (git-ignored).
- BlueMap will be configured on the AMP host to listen on `10.77.0.2` only.

## 5. What the VPS session owes the AMP host session (via Alex)

Print both in `11-status.md` so Alex can copy them:

1. The VPS WireGuard **public** key (from the keys generated in step 3).
2. `deploy.pub` (ed25519, generated for `api`; private key at `deploy/keys/deploy.key`, git-ignored).

## 6. Doc edits (one commit, `docs: apply planner decisions 13`)

- 12: mark §1 domain row, §3, §5 and §2 item 1 as superseded by 13 (one line each), don't rewrite it.
- 02: components diagram and tunnel section per §3; AMP integration per §4 (ADS proxy, no instance port); note that `api:4000` is reachable only from `internal`.
- 04: `Domain=.deepslate.dsw.test`; invite link host `deepslate.dsw.test`; service token note.
- 08: registry path `apps/api/src/actions/registry.ts`; AMP calls go through the ADS proxy path; `AMP_INSTANCE_ID`.
- 09: compose services `web, api, wireguard, map-relay-inner, map-relay-outer, postgres, backups`; Caddy per §3; `.env` gains `API_SERVICE_TOKEN`, `AMP_URL=http://10.77.0.2:8080`, `AMP_INSTANCE_ID`, `AMP_TUNNEL_IP=10.77.0.2`, `COOKIE_DOMAIN=.deepslate.dsw.test`, `MAP_URL=https://map.deepslate.dsw.test`, `RSYNC_TARGET=amp@10.77.0.2:`; remove `AMP_INSTANCE_DIR`; firewall line = 51820 in `host-firewall.sh`, SSH unchanged.
- 10: open question 1 answered (deepslate.dsw.test / map.deepslate.dsw.test), 2 answered (ADS proxy over the tunnel, id pending), 3 answered (defaults: Normal, Corpse keeps items, PvP off), 5 pending.
- 11: "Where things are" (new containers, map host), deviations 3 and 4 resolved, keys printed, session log.
- the working rules: the "no more than this" sentence from §2.

## 7. Alex's to-do (in order)

1. DNS: `map.deepslate.dsw.test → 198.51.100.20`.
2. AMP: create instance `DeepslateWorks01` (Minecraft Java, NeoForge, 1.21.1, Java 21, 6 to 8 GB); create ADS user `webapp` with rights on that instance only; note the instance ID.
3. Discord OAuth app: redirect `https://deepslate.dsw.test/api/auth/callback/discord`, scope `identify`; `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `ADMIN_DISCORD_ID` → `deploy/.env`.
4. Ferry keys: VPS public key + `deploy.pub` (from `11-status.md`) → AMP host session; the AMP host's public key is already in §3.
5. Tell the AMP host session the instance name and ID (it finishes rrsync and confirms the ADS port slot); tell the VPS session the ID and the `webapp` password.
6. Click through Phase 0 acceptance (Discord login → admin page, second account via invite, third refused), then the VPS session tags `phase-0`.

## 8. VPS session: next steps

1. Doc edits per §6, commit.
2. Add the `map.deepslate.dsw.test` Caddy block (with `import common`), set `COOKIE_DOMAIN`, reload Caddy. No re-domain.
3. Add `wireguard`, `api` skeleton (Fastify, `/health`, service-token middleware, `AMP_MOCK` client, ADS-proxy path builder), `map-relay-inner`, `map-relay-outer` to compose. Generate the VPS WireGuard keys and the ed25519 deploy key. Add 51820 to `host-firewall.sh`. Bring it up; `tunnel: down` in `/health` is expected until the AMP host enables its side.
4. Then Phase 1 as docs/10 lists it, once the Phase 0 checklist is ticked.

## 9. Early access (planner decision, 2026-09-29; entry written by the VPS session at the planner's request)

**Decision.** Before "We're live" is switched on, single members can be let in. Admin → Players has a toggle for each member, "Early access". While the site is not live, a member with the flag is **treated as a normal player on a live site, not as an admin**.

| | Admin | Early access, not live | Player, not live | Anybody, live |
|---|---|---|---|---|
| Sees the server's address, the Install page, the Play button | yes | yes | no: the launch date instead | yes |
| Downloads the installer and the pack, fetches the mod list | always | while the server is available | no (`not_live`) | while the server is available |
| Presses Play | always | while the server is available | no | while the server is available |
| At the door | always in | Play first applies | held: "Not open yet. You'll be let in when the server goes live." | Play first applies |
| Let out of the entrance room once linked | yes | like anyone else | like anyone else | like anyone else |
| Admin pages, addresses, console lines | yes | no | no | no |
| Banner "Early access: things may still break. Tell Alex in Discord if they do." | no | yes | no | no |

- When the site is live the flag changes nothing. It is kept all the same.
- The flag on an admin changes nothing either; it counts from the moment they are made a player.
- Giving and taking away are in the event log ("Bramble09 gave Rowan early access").
- A report that a run "went through" is refused (403 `not_live`) from a player the portal is not open for: they cannot have fetched the mod list, and the report would open the door. Found by the live test on the day it was built. Reports of failed runs are taken from every member.
- The rules are one file, `apps/web/src/shared/access.ts` (the same in `api`), and one table of tests, `apps/web/tests/access.test.ts`.

**The door knows "not live"** (planner, 2026-09-29, the same evening; this closes the gap that stood here). Before anything else the door asks whether the server is open for the member: live, or early access, or an admin. While the site is not live, a linked player without the flag is held in the room with "Not open yet. You'll be let in when the server goes live.", **whatever Play first says and whether or not they have pressed Play**. Only then comes Play first. The rule is `doorRule` in `shared/access.ts`; its table of tests is live on/off × flag on/off × Play first on/off × Play pressed or not. Whoever waits is let in within seconds of the site going live or of the flag being given (then Play first applies, if it is on), back to where they stood. Somebody who links their account while the site is not live stays in the room, with that line instead of the link.

## 10. Decisions of 2026-09-29 (planner, from Alex)

- **Kill stays in the api** (Alex's call, overriding the earlier "never expose Kill"). Admin-only, confirm dialog, audited, shown only while the server is in "Stopping". Needed once during pre-generation when a sleep-triggered stop hung at "Saving worlds".
- **Pre-generation is a mode, not a loop.** Off / when nobody's online / now. The api flips `MinecraftModule.Limits.SleepMode` (permission `Settings.MinecraftModule.Limits.SleepMode` granted to `webapp`) while it runs and restores it after. It never starts or kills the server for pre-generation; before any stop it pauses Chunky and waits for the save.
- **The white room lives in its own dimension** (`deepslate:limbo`, datapack `modpack/datapacks/deepslate-limbo/`, shipped by Sync). Glass box over the void, End sky, forceloaded. Nothing in the overworld, nothing on BlueMap.
- **The AMP instance stays unmanaged.** ADS refuses Manage for it; Alex uses `http://10.0.10.8:8083/` directly (see docs/17). Not converting to managed, because that would move `webapp` to ADS auth and rework the api login.
- **FallingTree is base**, not votable. **TabTPS is dropped** (clashes with BlueMap).
- **News items may carry a picture** (PNG/JPEG/WebP, 3 MB, members only).

## 11. Decisions of 2026-09-30 (planner, from Alex)

- **Admins get the Minecraft server console.** A command line under the live console (Admin → Server → Console; since §13 only there). What an admin types goes to the server as it is, through AMP's console input (`Core.SendConsoleMessage`, the call the api already used): no list of allowed commands, no parsing, a leading `/` dropped. Up and down arrows for history; the answer shows in the live console straight away.
- It is the Minecraft console and nothing lower: never a shell on the VPS, the AMP host or a container, and never AMP's own settings or the instance's files.
- Admins only, checked in `web` and again in `api`; players and early-access members get 403. Every command is in the event log as "Alex ran: <command>". At most 5 a second for each admin (429 above that), so a stuck key cannot flood the server.
- the working rules's rule now reads: "Players never get raw console or shell access through the app. Admins get the Minecraft server console (AMP SendConsoleInput) and nothing lower; no shell, ever. Every admin console command is audited."
- **Inventory for admins** comes from the game's save of the player, `world/playerdata/<uuid>.dat`, read through AMP's file manager (VPS session's choice, allowed by this ruling): it works while the player is offline and is NBT rather than console text. "Refresh" sends `save-all` first and waits for "Saved the game", so it is as current as `data get entity` would be. The file browser's deny list is unchanged; only this route reads that one file.

## 12. Server status wording and wake on Play (planner, 2026-09-30)

**One set of words** (`shared/server-state.ts`, the same file in web and api), worked out in api from AMP's state plus what only the portal knows, and shown the same way on Home, the sidebar, the Control Room, the Server page, the Play button, the map and Stats:

| State | When | Words | Colour |
|---|---|---|---|
| online | AMP 20 | "Online, N playing" / "Online, nobody on, goes to sleep in about X min" (from AMP's `SleepDelayMinutes` and when it became empty; no sleep line while sleep mode is off) | green |
| asleep | AMP 30, 50 | "Asleep, join to wake it" | blue |
| waking | a wake from Play is running, until AMP says 20 | "Waking up… about N s" | amber |
| starting / restarting / stopping | AMP 5, 7, 10, 60 / 40 / 45 | "Starting…" / "Restarting…" / "Stopping…" | amber |
| off | AMP 0 after a clean stop, 200, 250 | "Switched off"; players: "The server is switched off. Ask Alex in Discord."; admins: the same and a Start button | grey |
| crashed | AMP 100, or 0 after a fall without a stop line (the recorder decides; kept across api restarts from the newest up/down row) | "Crashed"; admins: Start and a link to the last console lines | red |
| unreachable | api cannot reach AMP (no fresh status), AMP gives no state, or web cannot reach api | "Can't reach the server"; admins see the reason: login refused / tunnel down / instance not running / AMP not answering / the site's backend (api) isn't answering | red |

- `/status` answers 200 with `server`, `reason`, `sleepInMin` and `wake` also when AMP cannot be reached (it used to answer 502, which the site showed as "Unknown").
- The event log records the transitions in the same words: "Server online (started in X s)", "Server asleep (nobody on)", "Server restarting", "Server switched off", "Server crashed (it went down without shutting down first)", and, for admins, "Can't reach the server (<reason>)" / "The portal can reach the server again".
- Uptime counts Asleep and Waking as available (snapshots are saved as "Waking" while a wake runs). Downloads and Play are open while Online, Asleep or Waking.

**Wake on Play.** `POST /server/wake` in api (web: `/api/play/wake`, a member's session or the launcher token). For any member the door would let in (`isOpenFor`: admin, live, early access), checked in web's route and again in api from the database; only from Asleep; one `Core.Start` however often Play is pressed (a second Play while it wakes answers "already"); never from Switched off, Crashed, Starting/Stopping/Restarting or out of reach. Audited "<name> woke the server (Play)"; if AMP does not report Running within 3 minutes, "<name> tried to wake the server (Play); it didn't wake up" (FAILED). The Play button and DeepslateWorks.ps1 1.5.1 ask for it the moment Play is pressed, say "Waking the server, ready in about 30 s", then "Server ready" or "The server didn't wake up. Try again in a minute or tell Alex". Admins keep their Start; joining a sleeping server directly still wakes it through AMP.

## 13. Console placement and the inventory editor (planner, 2026-09-30)

**The console lives in one place:** Admin → Server → Console (live output and the command line). The drawer under every admin page is gone. The Control Room shows the last 5 console lines and "Open console". Admin-only access, the audit line ("Alex ran: …") and 5 commands a second are unchanged (§11).

**Inventory and ender chest editing, admins only.** Player page → Inventory (and the Control Room's player panel): two grids, Inventory (hotbar, main, armour, off-hand) and Ender chest (27), icons and counts, a tooltip with name, enchantments and mod.
- Online: read live (`data get entity <player>`). A slot → "Set item…" (a searchable picker over every item the server knows, with icons; count 1 to the stack size) or "Clear slot"; "Give…" for item and count. Ender chest slots the same way. Optional "Advanced" components in 1.21 syntax, judged by the server: if it refuses, its words are shown and nothing changes.
- Commands (actions/registry.ts, never free text): `inv.set` = `item replace entity <player> <slot> with <item>[<components>] <count>`, `inv.clear` = `item replace entity <player> <slot> with air`, `inv.give` = `give <player> <item>[<components>] <count>`, `inv.read` = `data get entity <player>`, `inv.notify` = a gray `tellraw` "An admin changed your inventory.". Slots `hotbar.0-8`, `inventory.0-26`, `armor.head|chest|legs|feet`, `weapon.offhand`, `enderchest.0-26` (`shared/slots.ts`).
- Item ids must be in the catalogue (`modpack build items`: vanilla from the game's own data report with exact stack sizes, mods from their jars); counts are held to the stack size (64 where a mod item's is not known; the server's "X can only stack up to N" is shown and remembered).
- A change counts only when the server has answered (the `give` / `item replace` replies in events/parse.ts). Then the player gets the chat line, the event log gets "Alex gave samoyedx 16 × create:andesite_alloy" / "Alex cleared samoyedx's enderchest.3" / "Alex set bramble09's hotbar.0 to minecraft:diamond_pickaxe" (a refusal is logged as failed), and the grids are read again from the player.
- Offline: read only, from the save file, with "Player is offline. Changes can be made when they're next on." Save files are never written.
- `POST /players/:name/inventory` (api), `/api/admin/inventory/<name>` (web): admins only, early access and players get 403, 5 changes a second.

## 14. Admin password sign-in (planner, 2026-10-01; entry written by the VPS session)

Admins get a way in that does not need Discord: username + password + authenticator code (or a recovery code), all three always, admins only. It sits under the Discord button as a small "Admin sign-in" link. Set up by each admin for themselves on `/me/sign-in`; another admin can only turn it off. 5 failures per username / 20 per address in 15 minutes lock for 15 minutes; one message for every failure but a lock. Sessions from it last 12 hours. Every attempt in the event log with address and country; every success shown to all admins for 24 hours (a banner; no Discord message without a bot token). Made a player = password sign-in deleted and every session ended (`User.sessionVersion`). Break-glass: `pnpm admin:reset-auth <username>` in the api container, a one-time link valid 15 minutes (docs/09). The members' invite-only email login is unchanged and separate. Details: docs/04 "Admin password sign-in".

