# 39 · Security fixes, batch 1

Security planner, 2026-10-07. Six small fixes from docs/38, for the VPS session, in this order. Each names the finding, the change in full, the acceptance checks to run and paste, and what to write in the report. All six land on `dev` and reach `main` in the next `dev` → `main` PR; S4 and S5 also need a step on the host after the deploy. No change-log entry: players see no difference.

Rules that apply to all six: no real domain, address, name or value in code, tests or the report (placeholders only); nothing printed from `.env`, `wg0.conf` or `.git/config` beyond what the check asks for; every git command on the VPS as `ladm`; no image built on the VPS.

## S1 · Close the image optimiser (SR-01, Medium)

**Why.** `/_next/image` answers anonymous requests, the config allows two remote hosts, nothing uses `next/image`, and CVE-2026-27980 lets the cache fill the disk.

**Change 1, `apps/web/next.config.ts`:** replace the `images` block

```ts
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "mc-heads.net" },
      { protocol: "https", hostname: "i.ytimg.com" },
    ],
  },
```

with

```ts
  // docs/38 SR-01: nothing uses next/image, and the optimiser's cache has no upper bound (CVE-2026-27980). Off, and
  // the middleware answers 404 for /_next/image so the route cannot be reached at all.
  images: { unoptimized: true },
```

**Change 2, `apps/web/src/middleware.ts`:** the handler gets one line before the `PUBLIC` test, and the matcher stops excluding `_next/image`:

```ts
export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/_next/image")) return new NextResponse(null, { status: 404 }); // docs/38 SR-01
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
```

```ts
export const config = {
  matcher: ["/((?!_next/static|favicon.ico|icon.svg|robots.txt|.*\\.(?:png|jpg|svg|webp|ico)$).*)"],
};
```

**Test:** `apps/web/tests/middleware-image.test.ts` (or next to the existing middleware tests, if there are any): `/_next/image?url=%2Fx.png&w=64&q=75` gets 404 from the middleware with and without a session.

**Acceptance (one live request before, one after; the only live requests in this spec, Alex may veto):**

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'https://<site>/_next/image?url=https%3A%2F%2Fmc-heads.net%2Favatar%2Fsteve&w=64&q=75'
```

Before the deploy the answer is expected to be `200` (which confirms the finding; write the code down either way). After the deploy: `404`. Also after: `https://<site>/_next/image?url=%2Fbranding%2Fx.png&w=64&q=75` → `404`, and the home page, the map and a sign-in still work. `deploy/check.sh` green.

## S2 · OpenSSL in the images (SR-06, Low)

**Change:** in both `apps/web/Dockerfile` and `apps/api/Dockerfile`, the first `RUN` of the `base` stage starts with an upgrade:

web:
```dockerfile
RUN apk upgrade --no-cache && apk add --no-cache libc6-compat openssl git && npm install -g pnpm@10 \
 && deluser node && addgroup -g ${APP_UID} app && adduser -D -u ${APP_UID} -G app app
```

api:
```dockerfile
RUN apk upgrade --no-cache && apk add --no-cache openssh-client rsync && npm install -g pnpm@10
```

**Acceptance (after CI has built `main`, on the VPS, read-only):**

```bash
docker run --rm --memory=128m --entrypoint apk ghcr.io/<owner>/deepslate-web:<sha> info -v libssl3 libcrypto3
```

and the same for `deepslate-api`. Expected: `3.5.8-r0` or later for both packages, both images. Snyk's next scan of `main` shows the ten container lows gone (or still reports the base image's tag: say which).

## S3 · A size on every request body (SR-07, Medium; closes SR-05)

**Change 1, Caddy (host, as `ladm`, the shared Caddyfile; reload recipe in `deploy/README.md`):** the site's block gains a body limit, and `deploy/Caddyfile.snippet` is updated to match:

```
deepslate.dsw.test {
	import common
	# docs/38 SR-07: no request body above what the biggest server action takes (26 MB of poll pictures)
	request_body {
		max_size 30MB
	}
	header X-Frame-Options SAMEORIGIN
	reverse_proxy deepslate-web:3000
}
```

**Change 2, a helper, `apps/web/src/server/read-json.ts` (new file, complete):**

```ts
import "server-only";

// docs/38 SR-07: req.json() buffers the whole body and Next.js puts no limit on a route handler. This reads the body
// in pieces and gives up past maxBytes, so a large body cannot fill the container's memory; Caddy's request_body
// limit is the outer bound. A route answers 413 for `too_large` and 400 for `not_json`.
export type ReadJson = { ok: true; body: unknown } | { ok: false; code: "too_large" | "not_json"; status: 413 | 400 };

export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<ReadJson> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return { ok: false, code: "too_large", status: 413 };
  if (!req.body) return { ok: true, body: {} };
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    got += value.byteLength;
    if (got > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, code: "too_large", status: 413 };
    }
    parts.push(value);
  }
  const text = new TextDecoder().decode(Buffer.concat(parts)).replace(/^﻿/, "");
  if (text.trim() === "") return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, code: "not_json", status: 400 };
  }
}
```

**Change 3, the four routes** use it instead of `req.json()`, keeping each route's behaviour for a missing or broken body:

- `api/launcher/start/route.ts`: `const r = await readJson(req); if (!r.ok && r.code === "too_large") return 413 {error:{code:"too_large",…}}; const body = schema.safeParse(r.ok ? r.body : {});` (a broken body is still "no hostname", as today).
- `api/polls/[id]/vote/route.ts`: `const r = await readJson(req); if (!r.ok) return Response.json({ error: { code: r.code, message: … } }, { status: r.status }); const body = r.body as { choices?: unknown } | null;`
- `api/admin/inventory/[name]/route.ts` and `api/admin/console/send/route.ts`: the same shape; the console line is at most 1000 characters, so 64 KB is plenty.

**Test:** `apps/web/tests/read-json.test.ts`: a 10-byte body parses; a body of 65 KB (one chunk) → `too_large`; a chunked body that grows past the limit → `too_large` and the reader is cancelled; `"{"` → `not_json`; an empty body → `{}`.

**Acceptance:**

```bash
head -c 1048576 /dev/zero | tr '\0' 'a' > /tmp/big.json
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data-binary @/tmp/big.json 'https://<site>/api/launcher/start'
```

Expected `413`. A 40 MB body → `413` from Caddy (the answer is Caddy's, not JSON). The app signs in and votes as before; a poll with eight pictures can still be made (the 26 MB action). `deploy/check.sh` green.

## S4 · The deploy refuses a changed `.git/config` (SR-09, High)

**Why.** `web` can write `.git`; `-c` overrides cannot undo `remote.origin.url`, `url.*.insteadOf` or `credential.helper` written there; the next deploy would fetch from, or run, what the attacker chose, as `ladm` and then as root.

**Step on the host, once, as root, after reading the file by eye:**

```bash
cat /home/ladm/Minecraft-site/.git/config
```

Every line must be one you recognise (`core.*`, `remote.origin.url` = the repository on GitHub, `remote.origin.fetch`, `branch.*`, `user.*`, maybe `credential.helper` pointing at `/home/ladm/.config/deepslate/git-credentials`). If anything is unexpected, stop and report it before going on. Then:

```bash
install -d -m 700 /root/.config/deepslate
runuser -u ladm -- git -C /home/ladm/Minecraft-site config --local --list | sort > /root/.config/deepslate/git-config.expected
chmod 600 /root/.config/deepslate/git-config.expected
```

**Change, `deploy/deploy.sh`:** this block goes right after the `git_here()` function and before the `deploy/.env` checks, so it runs before anything is fetched:

```bash
# docs/38 SR-09: `web` can write .git, and no `-c` can undo a remote.origin.url, url.*.insteadOf or credential.helper
# line written there. So .git/config is compared with a copy kept where web cannot reach, and any difference stops the
# deploy before anything is fetched. Make the copy once, as root, after reading .git/config by eye (docs/39 S4):
#   git config --local --list | sort > /root/.config/deepslate/git-config.expected
GIT_CONFIG_EXPECTED="${GIT_CONFIG_EXPECTED:-/root/.config/deepslate/git-config.expected}"
[ -s "$GIT_CONFIG_EXPECTED" ] || die "$GIT_CONFIG_EXPECTED is missing (docs/39 S4): read .git/config by eye, then
  runuser -u $owner -- git config --local --list | sort > $GIT_CONFIG_EXPECTED
Nothing was deployed."
config_diff=$(diff <(sort "$GIT_CONFIG_EXPECTED") <(git_here config --local --list | sort) || true)
[ -z "$config_diff" ] || die ".git/config is not the copy in $GIT_CONFIG_EXPECTED (docs/38 SR-09):
$config_diff
Look at .git/config before deploying. Update the copy only if the change is yours. Nothing was deployed."
```

`deploy/README.md` gains two lines: what the file is and how to remake it when a change to `.git/config` is yours.

**Acceptance (on the host, as root, in this order, with `IMAGE_TAG` set to the running image so nothing new is pulled):**

1. `sudo deploy/deploy.sh` runs through as normal (the copy matches).
2. `runuser -u ladm -- git -C /home/ladm/Minecraft-site config --local test.canary yes`, then `sudo deploy/deploy.sh` → stops at the new check, prints the `test.canary=yes` line, deploys nothing. Then `runuser -u ladm -- git -C /home/ladm/Minecraft-site config --local --unset test.canary` and a third run goes through.
3. The first deploy after `main` has this change still works: the script that runs is the old one (it reads the new one only on the next run), so the copy must exist **before** that deploy. Make it first.

**For the report:** the output of run 2 (the refusal) and the last line of run 3. Not the contents of the copy.

## S5 · `api` and the relay are not reachable from the AMP host (SR-10, Low)

**Before changing anything, read what is there** (host, root): `docker exec deepslate-wg iptables -S INPUT` and `docker exec deepslate-wg ss -ltn`. If an INPUT rule already drops tcp 4000 and 8100 on `wg0`, write that in the report and skip the change.

**Change, `deploy/wireguard/wg_confs/wg0.conf` (live, git-ignored) and `deploy/wireguard/wg0.conf.example`:** in `[Interface]`:

```
# docs/38 SR-10: the tunnel is for api to reach the AMP host, never the other way. What arrives on wg0 for api
# (4000) or the inner map relay (8100) is dropped; the service token stays the second layer.
PostUp = iptables -I INPUT -i wg0 -p tcp -m multiport --dports 4000,8100 -j DROP
PostDown = iptables -D INPUT -i wg0 -p tcp -m multiport --dports 4000,8100 -j DROP
```

Apply at a quiet moment with nobody on: `docker compose -f deploy/docker-compose.yml restart wireguard` recreates nothing, but if the container is recreated, `api` and `map-relay-inner` go with it (docs/02); then `sudo deploy/deploy.sh` with the running `IMAGE_TAG` brings all three back.

**Acceptance:**

- VPS: `docker exec deepslate-wg iptables -S INPUT` shows the DROP rule.
- VPS: `docker exec deepslate-web wget -qO- --header "Authorization: Bearer $API_SERVICE_TOKEN" http://deepslate-wg:4000/health` (inside `web`, where the variable is) → JSON with `"ok"`.
- AMP host (read-only, by the AMP host session): `nc -vz -w3 10.77.0.1 4000` → times out; the same before the change is expected to say open (write down both).
- The map still loads for a signed-in member; the portal's status line still shows the server.

## S6 · Mod addresses must be Modrinth's CDN (SR-11, Medium; Lock and Build half)

**Change 1, `packages/modpack/src/mod-url.ts` (new file, complete):**

```ts
// docs/38 SR-11: a file in the lock is fetched by Build on the VPS and by every PC. Modrinth's API only ever gives
// cdn.modrinth.com addresses, so anything else in a lock is a lock that was not written by Lock. Refused here, in
// Lock before it is written, in Build before it is fetched, and by lint.
export const MOD_HOST = "cdn.modrinth.com";

/** Why this address may not be fetched, or null when it may. */
export function modUrlProblem(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `not an address: ${url}`;
  }
  if (u.protocol !== "https:" || u.hostname !== MOD_HOST) return `not on https://${MOD_HOST}: ${url}`;
  return null;
}
```

**Change 2:** `lock.ts`, where a resolved file becomes a lock entry (around line 108): `const bad = modUrlProblem(file.url); if (bad) throw new Error(\`${slug}: ${bad}\`);`. `download.ts`, before the `fetch` on line 30: the same check, thrown as the download's failure. `lint`: every `files[].url` through `modUrlProblem`, an error per hit.

**Test:** `packages/modpack/tests/mod-url.test.ts`: `https://cdn.modrinth.com/data/x/versions/y/z.jar` → null; `http://cdn.modrinth.com/…` → problem; `https://cdn.modrinth.com.evil.example/…` → problem; `https://example.com/a.jar` → problem; `not a url` → problem. And one Build test with a lock entry on another host that fails before any fetch.

**Acceptance:** `pnpm modpack lint` on the real lock: 0 errors (every entry is already on the CDN; say the count). `deploy/check.sh` green. A lock edited by hand to another host makes Build fail with the file's name and address.

The app's half (the same check in `installer/app/src/Engine/Files.cs` `SaveModFile`, refusing before the download) goes into the launcher-chain spec with SR-12, so that the app ships once.

## Report template

One report for the batch, in docs/11 (a short section) with the detail pasted here or linked:

```
Batch 1 (docs/39), <date>, dev <sha>, main <sha> after the PR, deployed <date time UTC>
S1 image optimiser: before <code> / after <code>; local url <code>; test <name> passes; check.sh <green|what failed>
S2 OpenSSL: web libssl3 <version> libcrypto3 <version>; api the same; Snyk's next scan <what it says>
S3 body size: Caddy reloaded <time>; 1 MB to /api/launcher/start <code>; 40 MB <code>; app sign-in and vote <ok|what failed>; tests <names>
S4 .git/config copy: made <date>; run 1 <last line>; run 2 <the refusal, pasted>; run 3 <last line>
S5 wg0 rules: iptables before <the INPUT rules, pasted>; after <pasted>; /health from web <ok>; from the AMP host before <open|timeout> after <timeout>; map and status <ok>
S6 mod addresses: lint <n entries, 0 errors>; the edited-lock Build failure <its line>; tests <names>
Deviations from this spec: <none|what and why>
New routes, ports, secrets, dependencies or mounts: <none|which>
```

The security planner replies Approved, Approved with follow-ups or Blocked, and moves each finding in docs/38 to Fixed or Verified.
