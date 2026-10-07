# 40 · Security build order

Security planner, 2026-10-07. The complete instructions for the sessions that build: Part A for the VPS session, Part B for the AMP host session, Part C for Alex. Every item points at its finding in docs/38 and, for batch 1, at its spec in docs/39. Read docs/38 §1 to §3 first, then the part that is yours.

**Assumptions, made so that nothing waits** (Alex overrules any of them by saying so in docs/11):

1. The exe is signed with a key held as a GitHub Actions secret in an environment restricted to `main` (docs/38 §4, SR-12 C1). Alex makes the key (Part C).
2. The database dump is encrypted before it leaves the VPS (SR-17). The copies on the VPS stay as they are.
3. `.git` stays writable by `web` for now, with the deploy check of docs/39 S4 as the guard (SR-09). Making it read-only is a later decision.

**Rules for every task.** Work lands on `dev`; `deploy/check.sh` green before every push; one `dev` → `main` PR when a batch is done, then `sudo deploy/deploy.sh`. No real domain, address, name or value in code, tests, commit messages or reports. Nothing printed from `.env`, `wg0.conf`, `.git/config` or any key beyond what a check asks for. No image built on the VPS; the app is built only by `installer.yml`. Every git command on the VPS as `ladm`. Every task ends with its report lines in docs/11 and the security planner marks the finding Fixed or Verified in docs/38; "done" without the pasted output stays Open.

---

## Part A · VPS session

Order: A1 first (it closes an anonymous hole and a root path), then A2 and A3 in either order, A4 after Alex has made the key, A5 any time.

### A1 · Batch 1: docs/39 S1 to S6

Build exactly what docs/39 says, in its order, and fill in its report template. Three things to get right:

- S4: the golden copy `/root/.config/deepslate/git-config.expected` must exist **before** the first deploy of the new `deploy.sh`, so make it first (as root, after reading `.git/config` by eye).
- S5: read `docker exec deepslate-wg iptables -S INPUT` before changing anything, and apply at a quiet moment with nobody on.
- S1 and S3 each have one live request before and after; those are the only live requests in the batch.

### A2 · `web` and `api` hardening (SR-15, SR-16, SR-22, SR-24, SR-25, SR-27)

One PR, six small changes.

**SR-15, `api` takes the role from the database.** In `apps/api/src/auth.ts`, `requireAdmin` becomes async and, when the header says ADMIN, reads `User.role` for `x-user-id` (a `Map` cache of id → role with a 5 s lifetime, so the poller's callers do not hit the database every call); refuses with 403 unless the database says ADMIN. A missing or unknown id is refused. Keep the header for the username. Test: the token plus `x-user-role: ADMIN` and a player's id → 403; an admin's id → 200. Every caller of `requireAdmin` awaits it (grep for it; `server.ts` and the route files).

**SR-16, `api` gets an explicit environment.** In `deploy/docker-compose.yml`, replace `env_file: .env` on `api` with an `environment:` list of exactly the variables `apps/api/src/env.ts` reads: `AMP_INSTANCE_ID AMP_MOCK AMP_PASSWORD AMP_TUNNEL_IP AMP_URL AMP_USERNAME API_SERVICE_TOKEN DEPLOY_KEY_PATH DISCORD_BOT_TOKEN DISCORD_CLIENT_ID DISCORD_GUILD_ID DISCORD_WEBHOOK_ADMIN DISCORD_WEBHOOK_FEED DISCORD_WEBHOOK_UPDATES GEOIP_DB LIMBO_POS MODRINTH_USER_AGENT RSYNC_TARGET SPAWN_POS`, each as `${NAME:-}` (or `${NAME}` where `env.ts` requires it), keeping the `DATABASE_URL` and `PORTAL_URL` lines that are already there and adding `BACKUP_PUBLIC_KEY` for A3. Check: `docker exec deepslate-api sh -c 'env | cut -d= -f1 | sort'` shows no `AUTH_SECRET`, `POSTGRES_PASSWORD`, `DISCORD_CLIENT_SECRET` or `MANIFEST_KEY`; `/health` still `ok`; the bot still connects; Sync's dry run still works.

**SR-22, the authenticator seal gets its own key.** `deploy/.env` and `.env.example` gain `TOTP_SEAL_KEY` (`openssl rand -base64 32`, optional). `admin-login.ts`: the sealed string's version prefix (it already has one, the `v` field) says which key sealed it: the old version = derived from `AUTH_SECRET` as today, a new version = derived from `TOTP_SEAL_KEY`. `openSecret` opens both; `sealSecret` uses `TOTP_SEAL_KEY` when set; after a successful code check of a row sealed the old way, the row is re-sealed the new way (lazy migration, no command). Test: seal with the old key, open with both keys present; a new seal opens without `AUTH_SECRET`. Runbook line in docs/09: rotating `AUTH_SECRET` no longer resets authenticators once every admin has signed in once with `TOTP_SEAL_KEY` set.

**SR-24, a test that every POST route checks its origin.** `apps/web/tests/routes-origin.test.ts`: walk `src/app/**/route.ts`; for each file exporting `POST`, `PUT`, `PATCH` or `DELETE`, assert its source contains `fromAnotherSite(` or `userFromLauncherToken(` (bearer-only routes) or the inline origin check, or is in a short allow-list with a reason (`api/auth`, Auth.js's own). The test prints the routes it checked.

**SR-25, the stale comment.** In `deploy/.env.example`, the `MANIFEST_KEY` comment becomes: "For admins' own tools only (curl the mod list without a sign-in). Never stamped into an installer or shipped to a PC: openssl rand -hex 24".

**SR-27, capabilities dropped.** `cap_drop: [ALL]` on `web`, `api`, `map-relay-inner`, `map-relay-outer`, `postgres`, `backups` (the `wireguard` service keeps `NET_ADMIN`, and gets `cap_drop: [ALL]` plus `cap_add: [NET_ADMIN]` only if the tunnel still comes up with that; try it on a quiet moment, revert if not). Check: `docker inspect -f '{{.HostConfig.CapDrop}}' deepslate-web` shows `[ALL]`; `deploy.sh`'s health check passes; postgres starts (it drops privileges itself; if it needs `CHOWN SETUID SETGID`, add those three and say so).

**Report:** the 403/200 pair for SR-15; the `env` listing's variable names for SR-16; the test names and their output for SR-22 and SR-24; the `docker inspect` line for SR-27; `check.sh` green; the deploy's last line.

### A3 · The database dump is encrypted before it leaves the VPS (SR-17)

**Key.** Alex makes an RSA-3072 pair (Part C). The public key goes into `deploy/.env` as `BACKUP_PUBLIC_KEY` (the PEM with newlines replaced by `\n`, or base64 of the PEM; pick one, document it in `.env.example`). The private key never touches the VPS.

**Format,** `deepslate-YYYY-MM-DD.sql.gz.enc`: a first line of JSON `{"v":1,"alg":"aes-256-gcm","wrap":"rsa-oaep-sha256","key":"<base64 of the wrapped 32-byte key>","iv":"<base64, 12 bytes>"}`, a newline, the ciphertext of the `.sql.gz` bytes, and the 16-byte GCM tag at the end. Node's `crypto` only (`randomBytes`, `createCipheriv`, `publicEncrypt` with `RSA_PKCS1_OAEP_PADDING` and `oaepHash: "sha256"`), no new dependency.

**Code.** `apps/api/src/backup/encrypt.ts` (pure: a readable stream in, a readable stream out, plus `encryptFile(src, dst, publicKeyPem)`), used by `dump-push.ts` before the rsync: the `.enc` file is pushed instead of the `.sql.gz`, into the same `_backup/db/` folder; with `BACKUP_PUBLIC_KEY` unset the push stops with a logged line and the health watch says "dump not pushed: no backup key" (it must not fall back to pushing plain). The AMP host's status script counts `.enc` files as dumps (tell the AMP host session: Part B4).

**Decrypt,** `deploy/decrypt-dump.mjs` (Node, no dependencies): `node deploy/decrypt-dump.mjs <private.pem> <file.enc> <out.sql.gz>`. Runs on Alex's PC or inside the api container. docs/09's restore runbook gains the step. Test: `apps/api/tests/backup-encrypt.test.ts` round-trips a file with a key pair made in the test, and a wrong key fails.

**Acceptance:** the next 04:00 push lands a `.enc` in `_backup/db/` (the backups page or `status.json` shows it); decrypting it on a machine with the private key gives a `.sql.gz` that `gunzip -t` accepts; the AMP host's `deepslate-db/` keeps `.enc` files. Report the file name pattern and sizes, nothing from inside.

### A4 · The launcher chain: signed exe and checked downloads (SR-12 C1, C3, C4, C5; SR-11 app half; SR-13; SR-14)

One app release (the next version number; docs/07 gets its section as usual) plus the CI, Build and manifest changes it needs. Build the server side first so the exe's offer carries a signature before any app checks for one.

**C1, signing in CI.**

- Alex adds the public key to the repository as `installer/app/signing/public.pem` and the private key as the secret `INSTALLER_SIGNING_KEY` in a GitHub environment `release` whose deployment branch rule allows `main` only (Part C).
- `installer.yml`, job `publish` (main only): `environment: release`; after the download of the artifact and before the image: write the secret to a temp file with `umask 077`, `openssl dgst -sha256 -sign key.pem -out publish/DeepslateWorks.exe.sig publish/DeepslateWorks.exe`, then `openssl dgst -sha256 -verify installer/app/signing/public.pem -signature publish/DeepslateWorks.exe.sig publish/DeepslateWorks.exe` (the job fails if that does not say `Verified OK`), `shred -u key.pem`. The `FROM scratch` image copies the `.sig` too. The `publish` job needs `actions/checkout` for `public.pem`.
- A step in job `app` (every build): the modulus of `public.pem` (`openssl rsa -pubin -in installer/app/signing/public.pem -modulus -noout`, lower-cased hex) equals the constant in `installer/app/src/Core/Signing.cs`, so the exe always carries the key CI signs with.
- `deploy/deploy.sh`, step "installer exe": copies `DeepslateWorks.exe.sig` into `dist/ci/` with the other three files.
- `packages/modpack/src/build.ts` `takeCiExe`: after the checksum and `MZ` checks, verify the signature with Node's `crypto.verify("sha256", exeBytes, { key: publicPem, padding: RSA_PKCS1_PADDING }, sig)` using `installer/app/signing/public.pem` (read from the repo mount); a missing or wrong signature drops the exe with "not signed by the release key". `installer.json`'s `exe` gains `sig` (base64). `shared/installer-info.ts` passes `sig` on in `installer.exe`. Test: a Build fixture with a key pair made in the test; the real `public.pem` parses.
- **Bootstrap:** the first app version that checks arrives over today's path (checksum only). From then on an offer without a valid signature is refused and the app carries on as it is.

**C1, the app.** `installer/app/src/Core/Signing.cs`: the public key as two constants (`Modulus` hex, `Exponent` 65537) and `Keys`, a list, so that a second key can be shipped before a rotation; `Verify(byte[] data, byte[] sig)` with `RSACryptoServiceProvider` (`ImportParameters`, `VerifyData(data, "SHA256", sig)`), true if any key verifies. `SelfUpdate.Offer` gains `Sig`; `Apply` fails with "the site gave no signature for it" when `Sig` is empty and "the signature is not the release key's" when `Verify` is false, after the SHA-256 check and before the move. xUnit tests: a signature made in the test with a throwaway key is refused; a fixture signed with the real private key is not possible in tests (the key is not in the repo), so the test for the real key is the CI modulus step above plus the smoke test's self-update, which already runs against the built exe.

**C3, Java and NeoForge checked.** Lock: fetch `https://maven.neoforged.net/releases/net/neoforged/neoforge/<v>/neoforge-<v>-installer.jar.sha256` and write `neoforge_installer_sha256` into the lock; the manifest passes it on. The app (`Engine.cs`, the NeoForge step): after the download, SHA-256 must equal it, else the run fails with "The NeoForge installer download did not match. Press Play again, or tell Alex." The Java step asks `https://api.adoptium.net/v3/assets/latest/21/hotspot?os=windows&architecture=x64&image_type=jre&vendor=eclipse` for `binary.package.link` and `binary.package.checksum`, downloads `link`, checks the checksum the same way. Both facts go into the run's report (`java.checksumOk`, `neoforge.checksumOk`).

**SR-11, the app half.** `Files.cs` `SaveModFile` refuses a URL that is not `https://cdn.modrinth.com/…` before any download ("a mod address was not Modrinth's"); the config zip and the exe are fetched only from the site (`Http.ToSite`), which `Engine.cs` already does for the exe; make the config zip the same.

**C4, SR-13, the token under DPAPI.** `launcher.json` gets `"token_protected": "<base64 of ProtectedData.Protect(utf8 token, null, CurrentUser)>"`; the reader (one function, used by `SiteHome`, `LogBundle`, `HandOver` and the uninstaller) takes `token_protected` first, else the old `token` and rewrites the file protected. The old field is removed once rewritten.

**C5, SR-14, the poll token in a header.** The app sends `x-poll-token` on `GET /api/launcher/poll`; the route accepts the header, then the query string, for this release and the next; docs/07 says when the query string goes.

**Acceptance:** CI's `publish` log shows `Verified OK`; `dist/ci/` on the VPS has the `.sig`; Build (installer) prints the new "signed" line; the manifest (as an admin, with `MANIFEST_KEY`) has `installer.exe.sig`; a PC on the previous version updates itself and its report shows `updatedFrom`; a PC on the new version refuses an offer whose `sig` is edited (test on one PC with a copy of the manifest, or trust the xUnit test); the access log shows no `token=` after the release; a fresh install reports `java.checksumOk` and `neoforge.checksumOk` true. Change-log entry: players see nothing new, but a "the app now checks that updates really come from us" line is worth one sentence.

### A5 · CI and GitHub hygiene (SR-18 CI half, SR-19, SR-28)

- Pin `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `actions/download-artifact`, `pnpm/action-setup`, `docker/setup-buildx-action`, `docker/login-action`, `docker/build-push-action` to full commit SHAs in `ci.yml`, `installer.yml` and the worldgen workflow, with `# vX.Y.Z` after each. Add `permissions: { contents: read }` at the top of each workflow (jobs that push packages keep their own block). This goes with docs/10 item 11 (the Node 24 majors).
- **SR-19:** as root, without printing it: what `/root/.docker/config.json` holds for `ghcr.io` (a stored token or a credential helper), the token's kind (classic PAT, fine-grained PAT, or other), its scopes and expiry (GitHub → Settings → Developer settings shows them). If it is wider than `read:packages`, Alex replaces it (Part C) and the session runs `docker login ghcr.io` as root with the new one.
- **SR-28:** as root, paste the output of `sshd -T | grep -E '^(passwordauthentication|permitrootlogin|pubkeyauthentication|kbdinteractiveauthentication|allowusers|maxauthtries)'`, the number of lines in each user's `authorized_keys`, and whether fail2ban or `sshguard` is active. Change nothing.
- **docs/38 §7:** fill in the "last rotated" column from what the host shows (file dates are fine), dates only.

---

## Part B · AMP host session

All read-only unless marked. Report in the exact shape at the end.

### B1 · SR-20, the game port

- `grep -E '^(online-mode|enforce-secure-profile|enable-rcon)=' <instance>/Minecraft/server.properties`
- `docker inspect mc-router --format '{{json .Args}}'` (expect no `--default`, a `--connection-rate-limit`)
- The firewall rules for WAN: the lines that accept 25565/tcp, 24454/udp, 19132/udp, and that nothing else is open from the internet (`nft list ruleset` or `ufw status verbose`, only the inbound part).
- If `enable-rcon=true` with a port reachable off localhost, say so: that is a finding.

### B2 · SR-21, the instance container

- `docker inspect <instance container> --format '{{.HostConfig.NetworkMode}} {{.HostConfig.Privileged}} {{json .HostConfig.CapAdd}} {{.Config.User}}'` and `--format '{{json .Mounts}}'` with the source paths.
- Which VLAN or subnet the AMP host is on and whether the router lets that subnet reach the NAS, the other VLANs and the AMP host's own UI. One sentence each.
- The user AMP runs the instance as inside the container, and whether that user can write anywhere outside the instance folder and the backup share.

The planner rates SR-21 from this and writes a spec if the container reaches more than the instance folder and the backup share.

### B3 · SR-28, SSH on the AMP host

`sshd -T | grep -E '^(passwordauthentication|permitrootlogin|pubkeyauthentication|kbdinteractiveauthentication|allowusers|maxauthtries)'`, the `Match Address 10.77.0.1` block as it stands, the line count of `~amp/.ssh/authorized_keys` and that the deploy key's line still begins `command="/usr/bin/rrsync`, `restrict`, `from="10.77.0.1"`. The host key fingerprint (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`) for the VPS session to compare with `deploy/keys/known_hosts`.

### B4 · After A3 lands (a change)

The status script counts `_backup/db/*.enc` as dumps (today it looks for `.sql.gz`), and keeps the last 30 `.enc` files in `deepslate-db/` on the share by the same rule. Report the script's diff.

### Report shape

```
AMP host security checks, <date>
B1 online-mode=<v> enforce-secure-profile=<v> enable-rcon=<v>; mc-router args <pasted>; WAN accepts <ports>; anything else open from WAN <none|what>
B2 NetworkMode=<v> Privileged=<v> CapAdd=<v> User=<v>; mounts <source → target, each>; subnet/VLAN <...>; can reach NAS <yes|no> other VLANs <yes|no> AMP UI <yes|no>; instance user <name>, writes outside instance+share <yes|no, where>
B3 sshd <the six lines>; Match block <pasted>; authorized_keys amp <n> lines, deploy line starts <pasted prefix>; host key fingerprint <SHA256:...>
B4 <diff, after A3>
```

---

## Part C · Alex, in this order

1. **GitHub, five minutes** (SR-18): repository → Settings → Branches → `main` rule → tick "Do not allow bypassing the above settings"; organisation → Settings → Authentication security → "Require two-factor authentication"; repository → Settings → Code security → enable Secret scanning and Push protection.
2. **Snyk** (SR-02, SR-03, SR-04, SR-05, SR-08): ignore SNYK-JS-NEXT-15105315, the four POSTCSS ids, DEEPMERGETS-18912249 and ZOD-20510278 with an expiry of 90 days and the reason from docs/38; mark the 48 Code findings "not vulnerable".
3. **The signing key** (A4), on your PC, never on the VPS:
   ```
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out installer-signing.pem
   openssl rsa -in installer-signing.pem -pubout -out public.pem
   ```
   `installer-signing.pem` goes into your password manager and into a GitHub environment `release` (repository → Settings → Environments → New → `release`, deployment branches: `main` only) as the secret `INSTALLER_SIGNING_KEY` (paste the whole PEM). `public.pem` goes to the VPS session to commit as `installer/app/signing/public.pem`. Delete the private key file from disk afterwards.
4. **The backup key** (A3), the same way: `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out backup.pem` and `openssl rsa -in backup.pem -pubout -out backup-public.pem`; the private key into the password manager and nowhere else; the public one to the VPS session for `deploy/.env`.
5. **The GHCR credential** (SR-19), once the VPS session reports its scope: if it is wider than `read:packages`, make a fine-grained token with read access to packages only, with an expiry, and hand it to the VPS session for `docker login`.
6. **Start the sessions** with these lines:
   - VPS session: "Read docs/38 and docs/40 Part A. Build A1 (docs/39) first, then A2, A3, A4, A5. Report each in docs/11 as docs/39 and docs/40 say."
   - AMP host session: "Read docs/38 and docs/40 Part B. Run B1, B2 and B3, read-only, and report in the shape at the end of Part B. B4 after the VPS session says A3 has landed."
