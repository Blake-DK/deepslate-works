# Task: set up the WireGuard peer on the AMP host (homelab side)

You are running on the homelab machine that hosts CubeCoders AMP and the Deepslate Works Minecraft instance. Your job is to make this host a WireGuard peer of the VPS at **portal.dsw.test**, so that the portal's backend container (and only it) can reach the AMP instance API, BlueMap and rsync over the tunnel. The homelab initiates the tunnel, so nothing here is opened to the internet.

Work through the steps in order. Do not skip the verification. Ask before anything destructive (changing existing firewall rules, restarting AMP). Report at the end in the exact format under "Report back".

## Fixed values

| Item | Value |
|---|---|
| Tunnel subnet | `10.77.0.0/24` |
| VPS tunnel IP | `10.77.0.1` |
| This host's tunnel IP | `10.77.0.2` |
| VPS WireGuard endpoint | `198.51.100.20:51820` |
| VPS WireGuard public key | `<VPS_WG_PUBKEY>` (ask Alex; if not available yet, do steps 1 to 3 and 6 to 7, print this host's public key, and stop) |
| Interface name | `wg0` |
| Home public IP (for reference only) | `203.0.113.10`, dynamic unless Alex says otherwise |

## Network facts you can rely on

- The home network sits behind a UniFi router with default LAN → internet allow. **No inbound rule, port forward or DMZ is needed at home.** This host only initiates.
- The VPS firewall allows inbound UDP 51820 (from 203.0.113.10 or from any). If the handshake never completes, that rule on the VPS is the first thing to check, not the home router.
- If the AMP host's VLAN has custom egress rules in UniFi, the one rule needed is: allow UDP from this host to 198.51.100.20 port 51820 (Policy Engine, Internal → External, or Internet Out in the classic UI). Report if you can't confirm outbound UDP works (`nc -vzu 198.51.100.20 51820` says nothing useful; rely on `wg show` handshake).

## 1. Discover the environment (read-only)

Find and record, without changing anything:

- OS and version (`cat /etc/os-release`), init system (systemd expected), whether `nft` or `ufw` or plain `iptables` manages the firewall (`systemctl status nftables ufw firewalld` and `nft list ruleset`).
- The user AMP runs as (`ps -o user= -C AMP_Linux_x86_64` or `ps aux | grep -i amp`), usually `amp`.
- AMP's data directory (`/home/amp/.ampdata` by default) and the Minecraft instance directory: `ls ~amp/.ampdata/instances/`. Note the full path to the instance's `Minecraft/` folder (the one containing `mods/`, `config/`, `server.properties`).
- The instance's AMP API port: read `~amp/.ampdata/instances/<instance>/AMPConfig.conf` and look for `Webserver.Port` (or `ss -ltnp | grep AMP` to see which ports the instance process listens on; the ADS is usually 8080, instances 8081+).
- Whether BlueMap is already installed in the instance (`ls <instance>/Minecraft/mods | grep -i bluemap`) and its webserver port from `<instance>/Minecraft/config/bluemap/webserver.conf` (default 8100). If BlueMap isn't there yet, note that; the modpack sync will add it later and the firewall rule below still goes in now.
- Whether `wireguard-tools` and the kernel module are present (`which wg`, `modprobe wireguard && lsmod | grep wireguard`).
- Whether `rrsync` exists (`which rrsync`, or `/usr/share/doc/rsync/scripts/rrsync` / `/usr/bin/rrsync` depending on distro).

## 2. Install WireGuard

Debian/Ubuntu: `sudo apt update && sudo apt install -y wireguard wireguard-tools rsync`. Other distros: the equivalent package. The kernel module is built in on anything modern; if `modprobe wireguard` fails, stop and report.

## 3. Generate this host's keys

```
sudo mkdir -p /etc/wireguard && sudo chmod 700 /etc/wireguard
cd /etc/wireguard
(umask 077 && wg genkey | sudo tee amp-host.key | wg pubkey | sudo tee amp-host.pub)
sudo chmod 600 /etc/wireguard/amp-host.key
```

Print the **public** key. Never print or log the private key. If the VPS public key and endpoint are not known yet, stop here and report the public key.

## 4. Write `/etc/wireguard/wg0.conf`

```
[Interface]
Address = 10.77.0.2/24
PrivateKey = <contents of /etc/wireguard/amp-host.key>
# No ListenPort: this side only initiates.

[Peer]
# portal.dsw.test backend (wireguard container on the VPS)
PublicKey = <VPS_WG_PUBKEY>
Endpoint = 198.51.100.20:51820
AllowedIPs = 10.77.0.1/32
PersistentKeepalive = 25
```

`chmod 600 /etc/wireguard/wg0.conf`. AllowedIPs is a single /32 on purpose: only the VPS's tunnel address is routable through this interface, nothing else on the VPS.

## 5. Bring it up and make it persistent

```
sudo systemctl enable --now wg-quick@wg0
sudo wg show wg0
```

Expected: one peer, a `latest handshake` within the last two minutes once the VPS side is up, and transfer counters moving after `ping -c3 10.77.0.1`. If there's no handshake after 60 s, check: keys pasted correctly on both sides, the VPS firewall allows UDP 51820 from the home public IP 203.0.113.10 (or from any), system clock sane. `nc -vzu` is inconclusive for UDP; compare `wg show` on both ends.

## 6. Firewall: allow only the VPS tunnel IP, only to the three services

Match the tool already managing the firewall (found in step 1). Do not replace an existing ruleset; add to it. The rules, expressed as intent:

- On interface `wg0`, from `10.77.0.1`:
  - allow TCP to the AMP instance API port (from step 1, e.g. 8081)
  - allow TCP 8100 (BlueMap)
  - allow TCP 22 (rsync over SSH)
  - allow ICMP echo (so the VPS healthcheck ping works)
- Everything else arriving on `wg0`: drop.
- Do not touch rules for other interfaces. The LAN keeps whatever access it already has.

nftables example (adapt table/chain names to what exists):

```
table inet deepslate {
  chain input {
    type filter hook input priority -10; policy accept;
    iifname "wg0" ip saddr 10.77.0.1 tcp dport { <AMP_INSTANCE_PORT>, 8100, 22 } accept
    iifname "wg0" ip saddr 10.77.0.1 icmp type echo-request accept
    iifname "wg0" ct state established,related accept
    iifname "wg0" drop
  }
}
```

ufw example:

```
sudo ufw allow in on wg0 from 10.77.0.1 to any port <AMP_INSTANCE_PORT> proto tcp
sudo ufw allow in on wg0 from 10.77.0.1 to any port 8100 proto tcp
sudo ufw allow in on wg0 from 10.77.0.1 to any port 22 proto tcp
sudo ufw deny in on wg0
```

Make the rules persistent (nftables: `/etc/nftables.conf` + `systemctl enable nftables`; ufw is persistent by itself).

Check the AMP instance and BlueMap are actually listening on an address the tunnel can reach: `ss -ltnp | grep -E ':(<AMP_INSTANCE_PORT>|8100)\b'`. `0.0.0.0` is fine (the firewall scopes it). If either is bound to `127.0.0.1` only, note it in the report; changing AMP's bind address is Alex's call.

## 7. rsync target for mod syncs (restricted SSH key)

The VPS backend will push `mods/`, `config/` and `bluemap/` into the instance's `Minecraft/` folder with rsync over SSH. Set up a key-restricted entry for the AMP user so that key can do nothing else:

1. Ask Alex for the VPS deploy public key (`deploy.pub`). If not available, generate a placeholder line and note it in the report.
2. Locate `rrsync` (step 1). On Debian it's `/usr/bin/rrsync` from the `rsync` package, sometimes a gzipped script under `/usr/share/doc/rsync/scripts/` that needs copying to `/usr/local/bin/rrsync` and `chmod +x`.
3. Append to `~amp/.ssh/authorized_keys` (create the dir `700`, file `600`, owned by `amp`):

```
command="/usr/bin/rrsync <INSTANCE_DIR>/Minecraft",restrict,from="10.77.0.1" ssh-ed25519 AAAA... deploy@portal
```

`restrict` disables port forwarding, agent forwarding, pty. `from=` ties it to the tunnel IP. `rrsync <dir>` confines rsync to that directory tree.

4. Confirm sshd allows key auth for that user and does not allow password auth from `wg0` (check `PasswordAuthentication` in `/etc/ssh/sshd_config`; if it's `yes` globally, add a `Match Address 10.77.0.1` block with `PasswordAuthentication no`, then `sshd -t` and reload).

## 8. Verify end to end

From this host:
- `wg show wg0` shows a recent handshake.
- `ping -c3 10.77.0.1` succeeds.

Ask Alex to run, from inside the VPS `wireguard` container (or the backend container):
- `ping -c3 10.77.0.2`
- `curl -s -o /dev/null -w '%{http_code}\n' http://10.77.0.2:<AMP_INSTANCE_PORT>/API/Core/GetStatus` → expect `200` or `401`/`403` (reachable, needs login), not a timeout.
- `curl -s -o /dev/null -w '%{http_code}\n' http://10.77.0.2:8100/` → `200` if BlueMap is running, connection refused if not yet installed (fine), never a timeout.
- `rsync --dry-run -av -e "ssh -i /path/deploy.key" ./empty/ amp@10.77.0.2:` → lists the instance `Minecraft/` contents without error, and `ssh -i deploy.key amp@10.77.0.2 ls` is refused.

Also confirm from a LAN machine that nothing changed for it (AMP web UI still reachable as before).

## Do not

- Do not add a `ListenPort` or open any UDP port on the router. The homelab initiates.
- Do not widen `AllowedIPs` beyond `10.77.0.1/32`.
- Do not give the deploy key a shell, or add it to any user other than the AMP user.
- Do not restart AMP or the Minecraft server unless asked.
- Do not print private keys.

## Report back

```
AMP host WireGuard peer
  OS:                     <os + version>
  Tunnel IP:              10.77.0.2
  Public key:             <amp-host.pub>
  Handshake with VPS:     yes/no (<latest handshake age>)
  AMP user:               <user>
  Instance dir:           <full path to .../Minecraft>
  AMP instance API port:  <port>  (listening on <addr>)
  BlueMap:                installed/not yet, port 8100 (listening on <addr>)
  Firewall tool:          nftables/ufw/iptables, rules persisted: yes/no
  rrsync path:            <path>
  Deploy key installed:   yes/no (restricted to <dir>, from 10.77.0.1)
  sshd password auth from tunnel: disabled yes/no
  Anything Alex must do:  <list, or "nothing">
```

Paste the report into the VPS session: it needs the public key, the instance port and the instance dir for `.env` and `wg0.conf` on that side.
