# 17 · mc-router: several Minecraft servers on one public port

Planner spec, 2026-09-29. Runs on the AMP host (homelab). Lets `mc.dsw.test`, `boys.dsw.test`, `vanilla.dsw.test` and any future name share public port 25565, routed by the hostname the player typed. Works with vanilla, Paper, Fabric and NeoForge backends because it only reads the handshake and then pipes the connection through; no mod or plugin on any server.

## Why mc-router

- Hostname routing for any Java edition server type, no backend changes.
- One config line per route.
- Idle/wake hooks that fit AMP's "sleep when empty" behaviour.
- A single small Go container.

Not Velocity (needs a forwarding plugin per backend and is fiddly with NeoForge). Bedrock (UDP) and Simple Voice Chat (UDP) can't be routed by hostname; each keeps its own port.

## Layout (revised 2026-09-29: direct port forward, no Pangolin for Minecraft)

The home connection has a static IP (203.0.113.10) and unifi-01p port-forwards. Pangolin's raw TCP resources are protocol-unaware pipes that add a hop and nothing else for Minecraft, so Minecraft bypasses Pangolin entirely.

```
player -> mc.dsw.test:25565 -> 203.0.113.10 (unifi-01p forward) -> mc-router:25565 (AMP host) -> AMP instance game port
```

- unifi-01p: forward 25565/tcp, 24454/udp (Simple Voice Chat) and 19132/udp (Bedrock) to the AMP host at 10.0.10.8. The forwards that pointed at pangolin-01v (10.0.10.7) are repointed.
- DNS: `mc.dsw.test`, `boys.dsw.test`, `vanilla.dsw.test` → 203.0.113.10 (not the VPS).
- Pangolin keeps HTTP resources only. The portal, its WireGuard tunnel and everything on the VPS are unchanged.
- Why not Caddy or Traefik on the AMP host: their TCP routing matches TLS SNI, and Minecraft's handshake is not TLS, so they cannot see the hostname. mc-router parses the Minecraft handshake itself.

Because the AMP host is now internet-facing on 25565: no `--default` route in mc-router (unknown hostnames and raw-IP connections are dropped), `--connection-rate-limit` on, and the host firewall accepts only 25565/tcp and the UDP game ports from WAN. Instance game ports stay bound to or firewalled to localhost.

## Task for the AMP host session

1. **Discover game ports.** For each instance: `grep -i "server-port\|Server.Port\|GamePort" /home/amp/.ampdata/instances/<name>/AMPConfig.conf` and `MinecraftModule.kvp`, cross-check with `ss -ltnp` while the instance runs. Record instance name → game port. Known so far: DeepslateWorks01 = 25569.
2. **Bind addresses.** Each instance's game port must be reachable from the mc-router container. If instances bind `0.0.0.0` (usual for game ports; only the AMP API binds 127.0.0.1) nothing changes. If one binds 127.0.0.1, run mc-router with `network_mode: host` so it can reach loopback, and note it.
3. **Run mc-router** (as `amp` or root, Docker):

   ```yaml
   services:
     mc-router:
       image: itzg/mc-router:latest
       container_name: mc-router
       network_mode: host            # simplest on a host with many instances; listens on 25565
       command:
         - --port=25565
         - --mapping=mc.dsw.test=127.0.0.1:25569
         - --mapping=boys.dsw.test=127.0.0.1:<port>
         - --mapping=vanilla.dsw.test=127.0.0.1:<port>
         # no --default: unknown hostnames and raw-IP scanners are dropped
         - --connection-rate-limit=20
       restart: unless-stopped
   ```

   Verify with `docker logs mc-router` and `ss -ltnp | grep 25565`. If 25565 is already taken by an instance, move that instance's game port (AMP settings, restart) rather than mc-router.
4. **Firewall on the AMP host.** Accept 25565/tcp, 24454/udp and (if Bedrock) 19132/udp from any source; keep every instance game port (25567–25570 etc.) closed to anything but localhost so only mc-router reaches them. The existing wg0 rules and the AMP UI's LAN-only access are unchanged.
5. **PROXY protocol.** Off by default. Paper can accept it (`proxy-protocol` in paper config) if Alex ever wants real player IPs for bans; NeoForge cannot. Leave off for now, note it.
6. **Report:** the route table with real ports, whether any instance had to be rebound, and the `mc-router` log line for one test connection per hostname.

## Task for Alex

- unifi-01p: port forwards 25565/tcp (`mc-java`), 24454/udp (`mc-voice`), 19132/udp (`mc-bedrock`) → AMP host **10.0.10.8**, WAN1. The old `pang-minecraf-java` and `pang-minecraft-bedrock` rules are repointed from 10.0.10.7 (Pangolin) to 10.0.10.8 and renamed; remove any Minecraft raw resources in Pangolin.
- DNS: `mc.dsw.test`, `boys.dsw.test`, `vanilla.dsw.test` → 203.0.113.10.
- Voice chat: one UDP port per server that runs it; Deepslate Works uses 24454. Another server wanting voice chat needs its own port and forward.

## Portal impact

None required. The portal's manifest already says `mc.dsw.test`, no port. If more servers get portals later, the routing is already in place.

## Acceptance

- [ ] From outside the LAN, `mc.dsw.test` reaches DeepslateWorks01, `boys.dsw.test` reaches TheBoysareback01, `vanilla.dsw.test` reaches the vanilla instance, all on 25565.
- [ ] Connecting by raw IP (203.0.113.10) is refused by mc-router (no default route).
- [ ] A sleeping AMP instance wakes on the first connection through mc-router (AMP's own wake-on-connect handles it; mc-router just forwards).
- [ ] Voice chat and Bedrock still work as before.

## Bedrock: NetherNet, not RakNet (found 2026-09-29)

This Bedrock server build refuses RakNet ("NetherNet is the only supported transport type"), so the classic UDP 19132 forward is wrong. NetherNet uses **TCP 19132** for the join handshake and a **UDP port range** for gameplay; the range was unset (random ports, unforwardable) and is now pinned to **19134–19153** in the instance config. Forwards on unifi-01p:

| Rule | Protocol | Forward |
|---|---|---|
| `mc-bedrock` | TCP 19132 | 10.0.10.8:19132 |
| `mc-bedrock-play` | UDP 19134–19153 | 10.0.10.8 same range |

Remove the old UDP 19132 forward. Monitoring: Bedrock is a plain TCP check on 10.0.10.8:19132; Kuma's Bedrock game monitor (UDP ping) will always fail with NetherNet. Config backups: `/root/mc-router-backup-20260929-091926/bedrock/` on the AMP host.

## Monitoring (Uptime Kuma on 10.0.10.7)

Java: "Minecraft Server" monitors on `mc.dsw.test`, `boys.dsw.test`, `vanilla.dsw.test`, port 25565 (hostnames, because mc-router routes by name and backend ports are localhost-only). A sleeping instance reports up: AMP answers status pings without waking it, so the check means "joinable". Voice chat (UDP 24454) has no usable check; it listens only while Deepslate Works is awake.

## DeepslateWorks01: web UI on the LAN and world seed (2026-09-29)

The instance is **unmanaged** (`Login.UseAuthServer=False`, kept on purpose so `webapp` stays instance-local). ADS therefore refuses Manage ("Unmanaged instances cannot be accessed from within ADS"); the instance UI is opened directly instead.

- **URL:** `http://10.0.10.8:8083/`, local admin `deepslate-adm`. `127.0.0.1:8083` no longer listens.
- **How it was bound:** editing `Webserver.IPBinding` in `AMPConfig.conf` is ignored (AMP rewrites it from its registry). The change needed `ampinstmgr rebind`, which requires ADS stopped; ADS was down ~70 s, other instances kept running.
- **Firewall:** TCP 8083 allowed from `10.0.10.0/24` and `10.0.21.0/24` only (`/etc/amp-acl/instance-ui.nft`, loaded by `amp-ui-acl.service`). Not open on wg0 or WAN.
- **Seed:** `Minecraft.WorldSeed=-3899835130120818196`, Level Name `world`. Applies only to a newly generated world; `server.properties` is rewritten from the setting on the next server start. Old world is moved aside by the VPS session (`world-backup-20260929`).
- **Portal impact:** the api still reaches the instance through the ADS proxy path on 8080; nothing on the VPS used `127.0.0.1:8083`. The VPS session re-checks the `webapp` login (`result: 10`) after the rebind.
- **State after the work:** server stopped (not asleep), so 25569 is closed and `mc.dsw.test` is offline until started; Kuma red until then.
- Backups of changed files: `/root/deepslate-backup-20260929-102917/` on the AMP host. The AMP host session's own copy of this doc lives at `/home/ladm/17-mc-router.md`; this file is canonical.

## DeepslateWorks01 JVM and auto-start (2026-09-30)

- **Auto-start:** `DaemonAutostart: True` (set with `ampinstmgr --SetStartBoot DeepslateWorks01 yes`, which needs ADS stopped). On 2026-09-30 05:26 UTC the VM was power-cycled from the hypervisor, ADS came back but the instance didn't (autostart was off), and the portal showed AMP login failures until the instance was started by hand at 05:54. If the portal says it can't reach the server and the instance isn't running: `ampinstmgr --StartInstance DeepslateWorks01`.
- **Heap:** 4096 / 10240 MB (AMP `Java.MinHeapSizeMB` / `MaxHeapSizeMB`). The VM has 15 GB, so the other Minecraft instances can't run alongside Deepslate at full heap.
- **Additional java options** (`MinecraftModule.Java.CustomOpts`): Aikar's G1 flags, without `-XX:G1RSetUpdatingPeriodMillis=5`, which Java 21 no longer recognises (the JVM refuses to start with it):
  `-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1`
