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

- unifi-01p: forward 25565/tcp, 24454/udp (Simple Voice Chat) and 19132/udp (Bedrock, optional) to the AMP host. Remove the Minecraft forwards that pointed at pangolin-01v.
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

- unifi-01p: port forwards 25565/tcp, 24454/udp, 19132/udp → AMP host LAN IP. Delete the Minecraft forwards to pangolin-01v and any Minecraft raw resources in Pangolin.
- DNS: `mc.dsw.test`, `boys.dsw.test`, `vanilla.dsw.test` → 203.0.113.10.
- Voice chat: one UDP port per server that runs it; Deepslate Works uses 24454. Another server wanting voice chat needs its own port and forward.

## Portal impact

None required. The portal's manifest already says `mc.dsw.test`, no port. If more servers get portals later, the routing is already in place.

## Acceptance

- [ ] From outside the LAN, `mc.dsw.test` reaches DeepslateWorks01, `boys.dsw.test` reaches TheBoysareback01, `vanilla.dsw.test` reaches the vanilla instance, all on 25565.
- [ ] Connecting by raw IP (203.0.113.10) is refused by mc-router (no default route).
- [ ] A sleeping AMP instance wakes on the first connection through mc-router (AMP's own wake-on-connect handles it; mc-router just forwards).
- [ ] Voice chat and Bedrock still work as before.
