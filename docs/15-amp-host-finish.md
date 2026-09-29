# Task: finish the AMP host setup (tunnel, deploy key, Deepslate Works instance)

Continuation of `setup-wireguard-amp-host.md`. You already prepared the WireGuard peer, the `inet deepslate` nft table, the `amp` user's authorized_keys placeholder, and the sshd `Match Address` block. Everything you need from the VPS is below. Work in order, ask before anything that restarts AMP or touches an existing instance, and finish with the report at the bottom.

## Inputs from the VPS

| Item | Value |
|---|---|
| VPS WireGuard public key | `IvQftNPCxX4H2jvwV6BYtZCkfkY7l6yb16T5PhP29ic=` |
| VPS endpoint | `198.51.100.20:51820` (already in your wg0.conf) |
| VPS tunnel IP | `10.77.0.1` |
| This host's tunnel IP | `10.77.0.2` |
| deploy.pub | `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIILAQ2zNCWgU8c2W84E7VPGhJtvCtDTm6lZF0sdT+Ueu deploy@portal` |
| Instance name | `DeepslateWorks01` |
| Instance API bind | `127.0.0.1`, next free AMP port (8083 per your report) |

Decision already made: the VPS talks to the **ADS on 8080** and reaches the instance through `/API/ADSModule/Servers/<InstanceID>/API/...`. Do not rebind any instance to 0.0.0.0.

## 1. Bring the tunnel up

1. Replace `<VPS_WG_PUBKEY>` in `/etc/wireguard/wg0.conf` with the key above. Confirm the file still has `Address = 10.77.0.2/24`, `AllowedIPs = 10.77.0.1/32`, `PersistentKeepalive = 25`, no `ListenPort`.
2. `systemctl enable --now wg-quick@wg0`.
3. Wait up to 60 s, then `wg show wg0` and `ping -c3 10.77.0.1`. Expected: a handshake under 2 minutes old, transfer counters rising, pings answered. The VPS side is already listening and its firewall allows 51820, so if there is no handshake: re-check the pasted key (no trailing whitespace), `journalctl -u wg-quick@wg0`, and outbound UDP from this host.

## 2. Firewall ports on wg0

Edit `/etc/wireguard/wg0-acl.nft` so the allowed TCP set from `10.77.0.1` is `{ 22, 8080, 8100 }` (8080 = ADS; the instance's own port is NOT needed). Keep icmp echo and established. Reload with `systemctl restart wg0-acl.service` and confirm with `nft list table inet deepslate`. Do not enable `nftables.service`.

Check the ADS actually listens on `0.0.0.0:8080` (`ss -ltnp | grep 8080`). If it's `127.0.0.1` only, stop and report; that's Alex's call.

## 3. Deploy key for rsync

Replace the placeholder line in `/home/amp/.ssh/authorized_keys` with:

```
command="/usr/bin/rrsync /home/amp/.ampdata/instances/DeepslateWorks01/Minecraft",restrict,from="10.77.0.1" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIILAQ2zNCWgU8c2W84E7VPGhJtvCtDTm6lZF0sdT+Ueu deploy@portal
```

File `600`, dir `700`, owned by `amp`. The target directory doesn't exist until step 4; that's fine, rrsync fails cleanly until then.

## 4. Create the Deepslate Works instance

Preferred: `ampinstmgr` as the `amp` user (or whichever user owns `/home/amp/.ampdata`), so the instance is registered with the ADS like the others. Read `ampinstmgr help` first for the exact syntax on this version, then:

- Module `Minecraft`, name `DeepslateWorks01`, bind `127.0.0.1`, port `8083` (or the next free one you find), same auth/ADS settings as the existing instances (compare with how `Minecraft01` was created: `ampinstmgr view Minecraft01` and its `AMPConfig.conf`).
- Do **not** start it yet.

Then configure it by editing the instance's config files rather than through the UI. Learn the key names from the existing Fabric instance `Minecraft01` (`/home/amp/.ampdata/instances/Minecraft01/MinecraftModule.kvp` and `AMPConfig.conf`) and set for `DeepslateWorks01`:

- Server type: **NeoForge**
- Minecraft version: **1.21.1**
- NeoForge version: the newest **21.1.x** stable listed by AMP (or the newest 21.1.x on `https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml` without `-beta`)
- Java: **21** (confirm a Java 21 runtime exists on this host, `ls /usr/lib/jvm`; if not, install `openjdk-21-jre-headless` and restart AMP only with Alex's OK)
- Memory: min 4096 MB, max 8192 MB, unless the host has under 16 GB free, then 6144 max; report what you chose
- Game port: leave AMP's default for the instance (Pangolin will point at it later; report the port)
- `server.properties` when it exists after first install: `online-mode=true`, `white-list=false`, `enforce-whitelist=false`, `spawn-protection=0`, `motd=Deepslate Works`, `max-players=20`, `view-distance=10`, `simulation-distance=8`, `difficulty=normal`, `pvp=false`. EULA accepted (`eula=true`) on Alex's behalf; he has agreed.

Ask Alex before the first start, then start it once (`ampinstmgr start DeepslateWorks01` or via ADS) so AMP downloads and installs NeoForge and generates the world folder, wait for "Done" in the console, then stop it. Mods come later from the VPS via rsync; the `mods/` folder should be empty after this step.

If `ampinstmgr` cannot set the module settings cleanly, stop after creating the instance and report; Alex can set NeoForge/1.21.1/Java 21/memory in the AMP UI in two minutes. Don't fight it.

## 5. Record the instance ID

The VPS needs the instance's GUID. Find it in `/home/amp/.ampdata/instances/DeepslateWorks01/AMPConfig.conf` (`InstanceID` or similar) and cross-check with `ampinstmgr list`. Put it in the report.

## 6. BlueMap placeholder (no install yet)

Create `/home/amp/.ampdata/instances/DeepslateWorks01/Minecraft/config/bluemap/` owned by `amp` and drop a `README` saying the VPS sync will populate it and that `webserver.conf` must have `ip: "10.77.0.2"` and `port: 8100`. Nothing else; BlueMap arrives with the modpack sync in a later phase.

## 7. Verify with the VPS

From this host: `wg show wg0` handshake fresh, `ping 10.77.0.1` ok.

Ask Alex to have the VPS session run, from inside the `deepslate-wg` container namespace:

- `ping -c3 10.77.0.2` → replies
- `curl -s -o /dev/null -w '%{http_code}\n' http://10.77.0.2:8080/API/Core/GetAPISpec` → a 2xx/4xx, not a timeout
- `ssh -i /run/keys/deploy.key -o BatchMode=yes amp@10.77.0.2 true` → refused with an rrsync message (expected), not a connection error
- once the instance exists: `rsync -e "ssh -i /run/keys/deploy.key" -av --dry-run /tmp/empty/ amp@10.77.0.2:` lists the instance's `Minecraft/` contents

Also confirm from the LAN that the AMP web UI still answers as before and that no other instance was touched.

## Do not

- Rebind any instance to 0.0.0.0, enable `nftables.service`, open anything inbound on the router, restart the ADS or existing instances without Alex's OK, or print private keys.
- Install mods, BlueMap or FTB Essentials; those come from the VPS.

## Report back

```
AMP host · finish-up
  Tunnel:              up/down, handshake <age>, ping 10.77.0.1 ok/fail
  wg0 ACL:             tcp {22, 8080, 8100} from 10.77.0.1, persisted yes
  ADS listen:          0.0.0.0:8080 yes/no
  Deploy key:          installed, rrsync root /home/amp/.ampdata/instances/DeepslateWorks01/Minecraft
  Instance:            DeepslateWorks01 created yes/no, API 127.0.0.1:<port>, game port <port>
  Instance ID:         <guid>
  Module settings:     NeoForge <ver>, Minecraft 1.21.1, Java 21 (<path>), memory <min>/<max> MB, set via <ampinstmgr|kvp|needs UI>
  First start:         done/not done, NeoForge installed yes/no, world generated yes/no, mods/ empty yes/no
  server.properties:   applied yes/no
  Anything Alex must do: <list, or "nothing">
```

Paste the report to Alex; the VPS session needs the Instance ID and the game port, and Alex still creates the ADS user `webapp` in the AMP UI (rights on DeepslateWorks01 only: login, console read/write, player list, start/stop/restart, file manager read).
