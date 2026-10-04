#!/usr/bin/env bash
# The only way to deploy Deepslate Works on vps-01v:
#   git pull  ->  docker compose pull  ->  docker compose up -d  ->  docker image prune
#
# Images are built by CI and pulled from GHCR. This host never builds: on 2026-09-29 a build here
# used all the memory and the kernel killed live services. Do not add `--build` to anything.
#
#   sudo deploy/deploy.sh            deploy the images CI built for the commit the checkout is at after the pull
#   sudo IMAGE_TAG=<sha> deploy/deploy.sh    pin or roll back to one commit's images
#   sudo ALLOW_API_DOWN=1 deploy/deploy.sh   deploy although api cannot reach the AMP host (the homelab is down)
#
# docs/31 B-08: the images are the ones of this commit, never the moving `latest`. CI tags both with the commit's
# sha; if it has not finished, the pull fails and nothing is changed. After `up` both containers must say they are
# that commit. IMAGE_TAG in deploy/.env is not read here (Dockhand's copy still uses it).
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")/.."
# one deploy, build or sync at a time on this host (deploy/ops-lock.sh); a second caller is told who holds it
. deploy/ops-lock.sh
ops_lock deploy || exit 75
echo "deploy by $(ops_caller)"
COMPOSE=(docker compose -f deploy/docker-compose.yml --env-file deploy/.env)
MIN_FREE_MB=600
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:3000/api/health}

die() { echo "deploy: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }

# git runs as the owner of the checkout, so root never leaves files in .git that `web` cannot write
owner=$(stat -c %U .)
as_owner() {
  if [ "$(id -u)" = 0 ] && [ "$owner" != root ]; then runuser -u "$owner" -- "$@"; else "$@"; fi
}
# docs/31 B-17: `web` can write this .git (Admin -> Lock commits there), and git runs here on the host. Whatever a
# broken-into web might leave in .git/hooks or .git/config must not run: no hooks, no fsmonitor, no ssh command.
git_here() { as_owner git -c core.hooksPath=/dev/null -c core.fsmonitor= -c core.sshCommand= "$@"; }

[ -f deploy/.env ] || die "deploy/.env is missing (copy deploy/.env.example)"
grep -Eq '^GHCR_OWNER=[a-z0-9-]+$' deploy/.env || die "set GHCR_OWNER in deploy/.env (GitHub owner, lower case)"
grep -Eq "^DEEPSLATE_DIR=$(pwd)\$" deploy/.env || die "set DEEPSLATE_DIR=$(pwd) in deploy/.env (absolute path of this checkout)"

avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
swap=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
echo "memory: ${avail} MB available, ${swap} MB swap"
[ "$swap" -gt 0 ] || die "no swap on this host; restore /swapfile before deploying"
[ "$avail" -ge "$MIN_FREE_MB" ] || die "only ${avail} MB available (need ${MIN_FREE_MB}); see what is using it: docker stats --no-stream"

step "git pull"
# Commits made here (Admin -> Lock and Apply results commit inside web, and never push) must reach origin/main
# through a PR first. On 2026-10-03 six of them sat here unpushed, so main fell behind the pack the server ran;
# a refused deploy beats a rebase done by hand.
git_here fetch -q origin main
unpushed=$(git_here log --format='  %h %s' origin/main..HEAD)
[ -z "$unpushed" ] || die "the checkout has commits that are not on origin/main:
$unpushed
Push them as a branch (runuser -u $owner -- git push origin HEAD:refs/heads/<name>), open a PR, merge it, then deploy again. Nothing was deployed."
migrations_before=$(git_here rev-parse -q --verify 'HEAD:apps/web/prisma/migrations' || echo none)
git_here pull --ff-only
echo "at $(git_here log -1 --format='%h %s')"
head_sha=$(git_here rev-parse HEAD)
migrations_after=$(git_here rev-parse -q --verify 'HEAD:apps/web/prisma/migrations' || echo none)
IMAGE_TAG=${IMAGE_TAG:-$head_sha}
export IMAGE_TAG
echo "images: $IMAGE_TAG"

step "pull images"
# Only our two images. The third-party ones (postgres, wireguard, socat) are updated on purpose, not by a deploy.
"${COMPOSE[@]}" pull web api || die "no images tagged $IMAGE_TAG yet: CI has not finished (or failed) for this commit. Nothing was changed. Look at the run on GitHub, then deploy again."

# docs/31 B-19: web applies the migrations when it starts, and there is no way back from one. So when this pull
# brought a new migration, the database is dumped first, next to the nightly dumps (pre-* dumps are never removed).
if [ "$migrations_before" != "$migrations_after" ] && docker inspect deepslate-db >/dev/null 2>&1; then
  step "dump before the new migration"
  [ "$(id -u)" = 0 ] || die "a new migration is in this deploy and the dump before it needs root (the dumps' folder is root's)"
  pre="${DUMP_DIR:-/root/docker/deepslate/backups}/pre-${head_sha:0:7}-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
  docker exec deepslate-db pg_dump -U deepslate deepslate | gzip > "$pre.part" || { rm -f "$pre.part"; die "the dump before the migration failed; nothing was changed"; }
  [ -s "$pre.part" ] || { rm -f "$pre.part"; die "the dump before the migration is empty; nothing was changed"; }
  mv "$pre.part" "$pre"
  echo "$pre ($(stat -c %s "$pre") bytes)"
fi

# api writes dist/ (modpack build) as uid 1000; web only reads it
if [ "$(stat -c %u dist 2>/dev/null || echo none)" != 1000 ]; then
  [ "$(id -u)" = 0 ] || die "dist/ must belong to uid 1000; run this once as root"
  mkdir -p dist && chown -R 1000:1000 dist
  echo "dist/ now belongs to uid 1000"
fi

# Deepslate Works 3.0: the Windows app is built and tested by CI on a windows runner (.github/workflows/installer.yml)
# and published as a tiny image holding only DeepslateWorks.exe, its .sha256 and VERSION. Copied out into dist/ci/;
# Admin -> Build (installer) checks it and hands it out. Never fatal: without it the site keeps the PowerShell one.
step "installer exe"
INSTALLER_IMAGE="ghcr.io/$(sed -n 's/^GHCR_OWNER=//p' deploy/.env)/deepslate-installer:${INSTALLER_TAG:-latest}"
if docker pull -q "$INSTALLER_IMAGE" >/dev/null 2>&1; then
  cid=$(docker create "$INSTALLER_IMAGE" none)
  rm -rf dist/ci.new && mkdir -p dist/ci.new
  if docker cp "$cid:/DeepslateWorks.exe" dist/ci.new/ && docker cp "$cid:/DeepslateWorks.exe.sha256" dist/ci.new/ && docker cp "$cid:/VERSION" dist/ci.new/; then
    rm -rf dist/ci && mv dist/ci.new dist/ci && chown -R 1000:1000 dist/ci
    echo "DeepslateWorks.exe $(cat dist/ci/VERSION) in dist/ci (run Build -> installer to publish it)"
  else
    rm -rf dist/ci.new; echo "the installer image has no exe; dist/ci left as it was"
  fi
  docker rm "$cid" >/dev/null
else
  echo "no installer image ($INSTALLER_IMAGE) yet; the site keeps what it hands out now"
fi

# The deploy key is read by api and the WireGuard config by its container, both as uid 1000. A careless
# `chown -R` over deploy/ takes them away from both (it happened on 2026-09-29: api lost rsync).
for p in deploy/keys/deploy.key deploy/wireguard; do
  [ -e "$p" ] || continue
  if [ -n "$(find "$p" ! -uid 1000 ! -name 'wg0.conf.example' -print -quit)" ]; then
    [ "$(id -u)" = 0 ] || die "$p must belong to uid 1000; run this once as root"
    find "$p" ! -name 'wg0.conf.example' -exec chown 1000:1000 {} +
    echo "$p given back to uid 1000"
  fi
done

# web keeps uploaded pictures here (Admin → Branding); it runs as the owner of the checkout
if [ ! -d data/branding ]; then
  mkdir -p data/branding
  [ "$(id -u)" = 0 ] && chown -R "$owner": data
  echo "created data/branding"
fi
# and the pictures of news items (Admin → Server → Announce)
if [ ! -d data/news ]; then
  mkdir -p data/news
  [ "$(id -u)" = 0 ] && chown "$owner": data/news
  echo "created data/news"
fi

step "up"
"${COMPOSE[@]}" up -d --remove-orphans

step "dockhand mirror"
# Dockhand keeps a copy of the compose file and env so the stack can be pulled and restarted from its UI.
# Refresh it; this never restarts anything, and a failure here does not fail the deploy.
if [ -r "${DOCKHAND_KEY_FILE:-/root/.config/deepslate/dockhand-key}" ]; then
  deploy/dockhand-sync.py || echo "deploy: Dockhand mirror NOT updated (the deploy itself is fine); run deploy/dockhand-sync.py later"
else
  echo "no Dockhand key on this host, skipped"
fi

step "health"
for i in $(seq 1 30); do
  state=$(docker inspect -f '{{.State.Health.Status}}' deepslate-web 2>/dev/null || echo missing)
  [ "$state" = healthy ] && break
  sleep 3
done
[ "$state" = healthy ] || die "deepslate-web is '${state}' after 90 s: docker logs --tail 50 deepslate-web"

# docs/31 B-09: a deploy with api broken used to print "deployed." all the same. api has its own healthcheck now
# (it answers), and web's health says whether api reaches the AMP host (tunnel, AMP, rsync).
for i in $(seq 1 40); do
  api_state=$(docker inspect -f '{{.State.Health.Status}}' deepslate-api 2>/dev/null || echo missing)
  [ "$api_state" = healthy ] && break
  sleep 3
done
[ "$api_state" = healthy ] || die "deepslate-api is '${api_state}' after 120 s: docker logs --tail 50 deepslate-api"

# both containers run this commit's images (only checked when the tag is a commit)
if [[ "$IMAGE_TAG" =~ ^[0-9a-f]{40}$ ]]; then
  for c in deepslate-web deepslate-api; do
    got=$(docker exec "$c" printenv PORTAL_COMMIT 2>/dev/null || echo none)
    [ "$got" = "$IMAGE_TAG" ] || die "$c runs commit '$got', not $IMAGE_TAG"
  done
  echo "web and api both run $IMAGE_TAG"
fi

# with the service token as the key, web's health gives the detail (tunnel, amp, rsync); without it, yes or no only
read_health() { docker exec -e HEALTH_URL="$HEALTH_URL" deepslate-web sh -c 'wget -qO- --header "x-health-key: $API_SERVICE_TOKEN" "$HEALTH_URL"' || true; }
health=$(read_health)
# When the tunnel's container was recreated, the AMP host has to shake hands again, and it is the side that starts
# it: on 2026-10-04 that took about three minutes, and this check, six seconds after `up`, called a good deploy
# failed. So a tunnel that is down is waited for, up to four minutes, before anything is said about it.
if ! printf '%s' "$health" | grep -q '"api":{"ok":true' && [ "${ALLOW_API_DOWN:-0}" != 1 ]; then
  echo "api does not reach the AMP host yet; waiting for the tunnel (up to 4 minutes)"
  for i in $(seq 1 24); do
    sleep 10
    health=$(read_health)
    printf '%s' "$health" | grep -q '"api":{"ok":true' && { echo "the tunnel is up after $((i * 10)) s"; break; }
  done
fi
echo "$health"
echo
docker ps --filter name=deepslate- --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
if ! printf '%s' "$health" | grep -q '"api":{"ok":true'; then
  [ "${ALLOW_API_DOWN:-0}" = 1 ] || die "the new containers are up, but api does not reach the AMP host (see \"api\" above: tunnel, amp, rsync). If the homelab is down on purpose, this deploy is in place and fine; otherwise: docker logs --tail 50 deepslate-api"
  echo "api does not reach the AMP host; accepted (ALLOW_API_DOWN=1)"
fi

# B-23: the AMP host's ssh key is pinned once this file exists; until then api trusts it afresh at each start
[ -s deploy/keys/known_hosts ] || echo "note: deploy/keys/known_hosts is missing. Make it once, with the AMP host's key:
  docker exec deepslate-api ssh-keyscan -t ed25519 10.77.0.2 > deploy/keys/known_hosts && chmod 644 deploy/keys/known_hosts
then compare its fingerprint with the AMP host's own (ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub there)."

step "prune old images"
docker image prune -f
echo "deployed."
