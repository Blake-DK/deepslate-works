# 17 · mc-router: several Minecraft servers on one public port

Planner spec, 2026-09-29. Runs on the AMP host (homelab). Lets `mc.dsw.test`, `boys.dsw.test`, `vanilla.dsw.test` and any future name share public port 25565, routed by the hostname the player typed. Works with vanilla, Paper, Fabric and NeoForge backends because it only reads the handshake and then pipes the connection through; no mod or plugin on any server.

## Why mc-router

- Hostname routing for any Java edition server type, no backend changes.
- One config line per route.
- Idle/wake hooks that fit AMP's "sleep when empty" behaviour.
- A single small Go container.

Not Velocity (needs a forwarding plugin per backend and is fiddly with NeoForge). Bedrock (UDP) and Simple Voice Chat (UDP) can't be routed by hostname; each keeps its own port.

## Layout

```
player -> mc.dsw.test:25565 -> Pangolin (VPS) -> Newt -> mc-router:25565 (AMP host) -> AMP instance game port
```

Pangolin's existing/new raw TCP resource for 25565 points at the AMP host's mc-router port instead of a single instance.

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
         - --default=127.0.0.1:25569   # unknown hostname / raw IP goes to Deepslate Works
         - --connection-rate-limit=20
       restart: unless-stopped
   ```

   Verify with `docker logs mc-router` and `ss -ltnp | grep 25565`. If 25565 is already taken by an instance, move that instance's game port (AMP settings, restart) rather than mc-router.
4. **Firewall on the AMP host.** Whatever allows Newt/Pangolin traffic to the old instance port must now allow 25565 to mc-router. Do not open anything to the internet; the AMP host is only reached via Newt.
5. **PROXY protocol.** Off by default. Paper can accept it (`proxy-protocol` in paper config) if Alex ever wants real player IPs for bans; NeoForge cannot. Leave off for now, note it.
6. **Report:** the route table with real ports, whether any instance had to be rebound, and the `mc-router` log line for one test connection per hostname.

## Task for Alex

- Pangolin: raw TCP resource, external 25565 → AMP host LAN IP port 25565 (mc-router). Remove or repoint the earlier 25569 resource if one exists.
- DNS: `mc.dsw.test`, `boys.dsw.test`, `vanilla.dsw.test` → VPS (the wildcard likely covers these).
- Voice chat: Simple Voice Chat UDP 24454 → AMP host 24454 stays a separate Pangolin UDP resource for Deepslate Works only. Another server wanting voice chat needs its own UDP port and resource.
- Bedrock (MinecraftBedrock01, UDP 19132) is unaffected and stays on its own Pangolin UDP resource.

## Portal impact

None required. The portal's manifest already says `mc.dsw.test`, no port. If more servers get portals later, the routing is already in place.

## Acceptance

- [ ] From outside the LAN, `mc.dsw.test` reaches DeepslateWorks01, `boys.dsw.test` reaches TheBoysareback01, `vanilla.dsw.test` reaches the vanilla instance, all on 25565.
- [ ] Connecting by raw VPS IP lands on the default route (Deepslate Works).
- [ ] A sleeping AMP instance wakes on the first connection through mc-router (AMP's own wake-on-connect handles it; mc-router just forwards).
- [ ] Voice chat and Bedrock still work as before.
