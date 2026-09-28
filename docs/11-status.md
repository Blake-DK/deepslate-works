# 11 · Status and handover

Written 2026-09-28 at the end of the Phase 0 build session. Read this before touching anything; update it at the end of every session. `docs/10-roadmap.md` stays the plan; this file records where reality is against it.

## Where things are

| Thing | Where |
|---|---|
| Repo (git, branch `main`) | `/opt/deepslate` on vps-01v |
| Live site | https://deepslate.dsw.test (placeholder domain, see open questions) |
| Compose stack `deepslate` | `/opt/deepslate/deploy/docker-compose.yml` → containers `deepslate-web`, `deepslate-db`, `deepslate-backups` |
| Secrets | `/opt/deepslate/deploy/.env` (mode 600, git-ignored; template `deploy/.env.example`) |
| Postgres data / dumps | `/root/docker/deepslate/postgres`, `/root/docker/deepslate/backups` (nightly, keep 7) |
| Reverse proxy | one block `deepslate.dsw.test` in `/root/docker/web-proxy/etc/Caddyfile` (backup of the pre-change file alongside it) |
| Health | `GET /api/health` → `{ok, db, amp, missingEnv, discord}` |

The VPS has no Node. Everything runs through Docker:

```
# checks (typecheck, lint, tests) without installing Node on the host
docker run --rm -v /opt/deepslate:/app -w /app node:22-alpine sh -c \
  'apk add --no-cache libc6-compat openssl >/dev/null && npm i -g pnpm@10 >/dev/null 2>&1 \
   && pnpm install --no-frozen-lockfile && cd apps/web && pnpm exec prisma generate \
   && pnpm typecheck && pnpm lint && pnpm test'

# deploy
cd /opt/deepslate && docker compose -f deploy/docker-compose.yml up -d --build

# Caddy reload after editing the Caddyfile
docker exec caddy sh -c 'caddy adapt --config /etc/caddy/Caddyfile --envfile /etc/caddy/caddy.env > /tmp/c.json \
  && wget -qO- --header="Content-Type: application/json" --post-file=/tmp/c.json http://127.0.0.1:2019/load'

# bootstrap invite (before any admin exists, or while Discord is unconfigured)
docker exec deepslate-web node apps/web/scripts/invite.mjs "for Alex" 14
```

Gotchas found the hard way: `CI=1` makes pnpm default to `--frozen-lockfile`; pnpm 10 needs `pnpm.onlyBuiltDependencies` (root `package.json`) for Prisma/esbuild postinstalls; ESLint plugins need the `public-hoist-pattern` lines in `.npmrc`; if you change `.npmrc`, delete `node_modules` before reinstalling.

## Phase 0 · what was built

Matches `docs/10-roadmap.md` Phase 0 "Build" list. Files worth knowing:

- `apps/web/src/auth.config.ts` (edge-safe: Discord provider, cookie, session callback) and `apps/web/src/auth.ts` (full: credentials provider, invite consumption in `signIn`, `jwt` lookup). Discord provider is only registered when `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are set; the UI says so.
- `apps/web/src/middleware.ts`: only checks "logged in" and redirects to `/login?next=`. Role and onboarding checks read the database per request in `src/server/auth/session.ts` (`requireUser`, `requireOnboardedUser`, `requireAdmin`), so promotions apply without re-login.
- `src/server/auth/users.ts` `createUser`: first user ever, or the `ADMIN_DISCORD_ID` account, becomes ADMIN. Invite is consumed in the same transaction.
- `src/server/auth/invite-codes.ts` (pure, tested), `invites.ts` (db), `rate-limit.ts` (in-memory 10/min per IP for login and registration; Caddy here has no rate_limit module), `can.ts` (permission table from docs/03).
- `src/server/mojang.ts`: username → UUID with a 6 s timeout; onboarding refuses names Mojang doesn't know or that another member already claimed.
- Pages: `/login`, `/join/[code]`, `/join/[code]/email`, `/onboarding`, `/` (home shell), `/admin`, `/admin/invites`, `/admin/users`, and placeholders for `/mods /vote /install /map /players`. Route group `(app)` requires an onboarded user; `(public)` does not.
- API: `/api/auth/[...nextauth]`, `/api/auth/verify` (200/401 for Caddy forward_auth, phase 3), `/api/health`.
- Prisma schema is the full one from docs/03 (Vote, Ballot, Announcement, AuditLog, ServerSnapshot already exist). Migration `0001_init` applied.
- Tests (vitest, 10 passing): permissions, invite codes/state, rate limiter, Minecraft username regex and UUID formatting. CI workflow in `.github/workflows/ci.yml` (repo has no remote yet).
- UI: hand-written primitives in `src/components/ui/` in the shadcn style (same `cn()` and CSS-variable tokens), so `npx shadcn add` can be used later without a rewrite. Dark/light via `data-theme`, remembered in localStorage.

## Deviations from the design docs (deliberate)

1. **Caddy.** docs/02 and docs/09 assume a Caddy of our own. This VPS already has one (stack `web-proxy`) fronting several sites, so the app joins the external `web` network and gets a block in the existing Caddyfile. No second proxy, no published ports. `deploy/Caddyfile.snippet` is the block.
2. **Rate limiting** lives in the app, not Caddy (module not present in `caddy:2-alpine`).
3. **AMP is not on this VPS.** docs/02 and 09 assume a bind mount of the AMP instance directory. Alex: "the users will access the game server via pangolin, the vps has nothing to do with it, you only speak to amp." So: AMP is reached over Tailscale by HTTP API only; `pangolin-01v` is the players' tunnel and is out of bounds. Phase 2's `sync-server` will therefore need the AMP file API (or SSH/rsync to the AMP host) instead of a bind mount; Phase 4's stats reads likewise. Update docs/02, 06, 09 when the AMP host is known.
4. **Domain** is a placeholder (`deepslate.dsw.test`, wildcard already on this VPS). `COOKIE_DOMAIN` is empty until the map host exists (phase 3), so the session cookie is host-only.
5. **Prisma 6** pinned (`^6`) rather than 7; the classic migrate workflow, boring on purpose.
6. **No Dockhand registration** yet (this VPS's other stacks are managed there). Do it when the stack shape settles, or leave it git-driven.

## Phase 0 acceptance (docs/10) · current state

- [x] `docker compose up -d` on the VPS serves the site over HTTPS.
- [ ] Alex logs in with Discord and lands on an admin page. *Blocked: no Discord OAuth app yet. Email route works; first account becomes ADMIN.*
- [ ] Invite link lets a second account in; a third without an invite is refused. *Code paths exist; not clicked through.*
- [ ] Email/password fallback works for one invite. *Renders; not clicked through end to end.*
- [x] `/api/auth/verify` returns 401 without a session (200 with one not yet exercised).

Bootstrap invite issued this session (14 days): `https://deepslate.dsw.test/join/2R97LWNC`.

## Open questions for Alex (blocking the next steps)

1. **AMP:** Tailscale IP/name of the AMP host, the Minecraft *instance's* API port (not ADS 8080), and the low-privilege `webapp` user + password → `AMP_URL`, `AMP_USERNAME`, `AMP_PASSWORD` in `deploy/.env`. The permission classifier in the build session refused network probes to AMP; get the values from Alex, don't scan for them.
2. **Discord OAuth app:** client id, secret, Alex's Discord user id (`ADMIN_DISCORD_ID`). Redirect URL `https://<domain>/api/auth/callback/discord`.
3. **Domain** for the site and the map subdomain (docs/10 open question 1).
4. Does anyone lack Discord? If nobody, the credentials provider can be removed (docs/10 open question 5).
5. Season 1 world settings if the vote doesn't cover them (docs/10 open question 4).

## Suggested plan updates for the next session

- Tick the Phase 0 boxes above with Alex, tag `phase-0`, then start Phase 1 (`/mods`, `/vote`, `/vote/results`, `/admin/votes`, `packages/modpack` with `lint` and `verify-links`, `modpack/mods.json` populated with verified Modrinth slugs and real video links).
- Revise docs/02 §"AMP integration", docs/06 `sync-server`, docs/09 "VPS layout" for the AMP-over-Tailscale model (no bind mount).
- Decide whether the repo gets a GitHub remote (CI file is ready) and whether the stack goes into Dockhand.
- Phase 3 prep: the map host needs a DNS name under the chosen domain and `COOKIE_DOMAIN` set; the Caddy block needs `forward_auth deepslate-web:3000 { uri /api/auth/verify }` and a `reverse_proxy` to BlueMap on the AMP host over Tailscale.
