#!/usr/bin/env bash
# The only way to deploy Deepslate Works on vps-01v:
#   git pull  ->  docker compose pull  ->  docker compose up -d  ->  docker image prune
#
# Images are built by CI and pulled from GHCR. This host never builds: on 2026-09-29 a build here
# used all the memory and the kernel killed live services. Do not add `--build` to anything.
#
#   sudo deploy/deploy.sh            deploy the newest images
#   sudo IMAGE_TAG=<sha> deploy/deploy.sh    pin or roll back to one commit's images
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")/.."
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
as_owner git fetch -q origin main
unpushed=$(as_owner git log --format='  %h %s' origin/main..HEAD)
[ -z "$unpushed" ] || die "the checkout has commits that are not on origin/main:
$unpushed
Push them as a branch (runuser -u $owner -- git push origin HEAD:refs/heads/<name>), open a PR, merge it, then deploy again. Nothing was deployed."
as_owner git pull --ff-only
echo "at $(as_owner git log -1 --format='%h %s')"

step "pull images"
# Only our two images. The third-party ones (postgres, wireguard, socat) are updated on purpose, not by a deploy.
"${COMPOSE[@]}" pull web api

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

step "prune old images"
docker image prune -f

step "health"
for i in $(seq 1 30); do
  state=$(docker inspect -f '{{.State.Health.Status}}' deepslate-web 2>/dev/null || echo missing)
  [ "$state" = healthy ] && break
  sleep 3
done
[ "$state" = healthy ] || die "deepslate-web is '${state}' after 90 s: docker logs --tail 50 deepslate-web"
docker exec deepslate-web wget -qO- "$HEALTH_URL" || true
echo
docker ps --filter name=deepslate- --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
echo "deployed."
