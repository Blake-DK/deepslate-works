#!/usr/bin/env bash
# The only way to deploy Deepslate Works on docker-01v (planner doc 62; the VPS keeps deploy/deploy.sh until the cutover):
#   git pull  ->  docker compose pull  ->  docker compose up -d  ->  docker image prune
#
# Images are built by CI and pulled from GHCR. This host never builds them. Do not add `--build` to anything.
#
#   sudo deploy/home/deploy.sh                 deploy the images CI built for the commit the checkout is at after the pull
#   sudo IMAGE_TAG=<sha> deploy/home/deploy.sh pin or roll back to one commit's images
#   sudo ALLOW_API_DOWN=1 deploy/home/deploy.sh   deploy although api cannot reach the AMP host
#
# docs/31 B-08: the images are the ones of this commit, never the moving `latest`. A commit that changed only docs has
# no images: it runs those of the last commit that changed code. Derived from deploy/deploy.sh (2026-10-23): no
# WireGuard, no Dockhand mirror, no designer; two roots (DEEPSLATE_DIR, DEEPSLATE_DATA); the geoip profile.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")/../.."
ENV_FILE=deploy/home/.env
die() { echo "deploy: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
[ -f "$ENV_FILE" ] || die "$ENV_FILE is missing (copy deploy/home/.env.example)"
DEEPSLATE_DATA=$(sed -n 's/^DEEPSLATE_DATA=//p' "$ENV_FILE" | tail -1)
[[ "$DEEPSLATE_DATA" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "set DEEPSLATE_DATA in $ENV_FILE (absolute path of the data root)"
# one deploy, build or sync at a time on this host (deploy/ops-lock.sh); the lock lives with the data, not under /root
OPS_LOCK=$DEEPSLATE_DATA/ops.lock OPS_HOLDER=$DEEPSLATE_DATA/ops.holder
. deploy/ops-lock.sh
ops_lock deploy || exit 75
echo "deploy by $(ops_caller)"
COMPOSE=(docker compose -f deploy/home/docker-compose.yml --env-file "$ENV_FILE")
MIN_FREE_MB=600
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:3000/api/health}

# git runs as the owner of the checkout, so root never leaves files in .git that `web` cannot write
owner=$(stat -c %U .)
as_owner() {
  if [ "$(id -u)" = 0 ] && [ "$owner" != root ]; then runuser -u "$owner" -- "$@"; else "$@"; fi
}
# docs/31 B-17: `web` can write this .git (Admin -> Lock commits there): no hooks, no fsmonitor, no ssh command.
git_here() { as_owner git -c core.hooksPath=/dev/null -c core.fsmonitor= -c core.sshCommand= "$@"; }
# .git/config and .git/hooks must match copies kept under /root, which web cannot reach (deploy/README.md).
. deploy/git-guard.sh
# deploy/rerun.sh: a pull that changes this script (or a file it sources) runs the new one, once
DEPLOY_SCRIPT=deploy/home/deploy.sh
DEPLOY_SELF_FILES="deploy/home/deploy.sh deploy/git-guard.sh deploy/ops-lock.sh deploy/rerun.sh"
. deploy/rerun.sh
check_git_guards() {
  GIT_CONFIG_EXPECTED="${GIT_CONFIG_EXPECTED:-/root/.config/deepslate/git-config.expected}"
  [ -s "$GIT_CONFIG_EXPECTED" ] || die "$GIT_CONFIG_EXPECTED is missing: read .git/config by eye, then
  runuser -u $owner -- git config --local --list | sort > $GIT_CONFIG_EXPECTED
Nothing was deployed."
  config_diff=$(diff <(sort "$GIT_CONFIG_EXPECTED") <(git_here config --local --list | sort) || true)
  [ -z "$config_diff" ] || die ".git/config is not the copy in $GIT_CONFIG_EXPECTED:
$config_diff
Look at .git/config before deploying. Update the copy only if the change is yours. Nothing was deployed."
  GIT_HOOKS_EXPECTED="${GIT_HOOKS_EXPECTED:-/root/.config/deepslate/git-hooks.expected}"
  [ -s "$GIT_HOOKS_EXPECTED" ] || die "$GIT_HOOKS_EXPECTED is missing: read each hook in .git/hooks by eye, then
  (cd .git/hooks && sha256sum pre-push) > $GIT_HOOKS_EXPECTED
Nothing was deployed."
  hooks_diff=$(git_hooks_problems .git/hooks "$GIT_HOOKS_EXPECTED")
  [ -z "$hooks_diff" ] || die ".git/hooks is not what $GIT_HOOKS_EXPECTED lists:
$hooks_diff
Look at .git/hooks before deploying. Update the list only if the change is yours. Nothing was deployed."
  hooks_path=$(as_owner git config --show-origin --get-all core.hooksPath || true)
  [ -z "$hooks_path" ] || die "core.hooksPath is set, so git on this host runs hooks from another folder:
$hooks_path
Remove it before deploying. Nothing was deployed."
}
check_git_guards

grep -Eq '^GHCR_OWNER=[a-z0-9-]+$' "$ENV_FILE" || die "set GHCR_OWNER in $ENV_FILE (GitHub owner, lower case)"
grep -Eq "^DEEPSLATE_DIR=$(pwd)\$" "$ENV_FILE" || die "set DEEPSLATE_DIR=$(pwd) in $ENV_FILE (absolute path of this checkout)"
# docs/42: the test pair is not wired up at home yet (no deploy/home/test-up.sh); its lines may keep their placeholders
grep -Eq '^TEST_STACK=1$' "$ENV_FILE" && die "TEST_STACK=1 is not supported by deploy/home yet (README); set TEST_STACK=0"
placeholders=$(grep -E '^[A-Z_]+=(.*replace-me.*|0{17,}|00000000-0000-.*)$' "$ENV_FILE" | cut -d= -f1 | grep -v '^TEST_' | tr '\n' ' ' || true)
[ -z "$placeholders" ] || die "$ENV_FILE still has placeholder values from .env.example: ${placeholders}(fill them in, or leave optional ones empty)"
geoip_on=0
if grep -Eq '^GEOIPUPDATE_ACCOUNT_ID=.+' "$ENV_FILE"; then geoip_on=1; COMPOSE+=(--profile geoip); fi

avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
echo "memory: ${avail} MB available"
[ "$avail" -ge "$MIN_FREE_MB" ] || die "only ${avail} MB available (need ${MIN_FREE_MB}); see what is using it: docker stats --no-stream"
docker network inspect ds-edge >/dev/null 2>&1 || die "the network ds-edge does not exist: docker network create -o com.docker.network.bridge.name=ds-edge ds-edge (and the site's newt runs on it)"

step "git pull"
# Commits made here (Admin -> Lock and Apply results commit inside web, and never push) must reach the branch this
# checkout follows first: origin/main for the live stack; origin/dev while the dry run (doc 62 §5.4) runs from dev.
upstream=$(git_here rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
[[ "$upstream" =~ ^origin/(main|dev)$ ]] || die "this checkout follows '${upstream:-no branch}', not origin/main or origin/dev. Nothing was deployed."
git_here fetch -q origin "${upstream#origin/}"
unpushed=$(git_here log --format='  %h %s' "$upstream..HEAD")
[ -z "$unpushed" ] || die "the checkout has commits that are not on $upstream:
$unpushed
Push them as a branch (runuser -u $owner -- git push origin HEAD:refs/heads/<name>), open a PR, merge it, then deploy again. Nothing was deployed."
running_web=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' deepslate-web 2>/dev/null | sed -n 's/^PORTAL_COMMIT=//p') || running_web=
if [[ "$running_web" =~ ^[0-9a-f]{40}$ ]] && git_here cat-file -e "${running_web}^{commit}" 2>/dev/null; then
  migrations_before=$(git_here rev-parse -q --verify "${running_web}:apps/web/prisma/migrations" || echo none)
else
  migrations_before=unknown
fi
before_pull=$(git_here rev-parse HEAD)
git_here pull --ff-only
echo "at $(git_here log -1 --format='%h %s')"
head_sha=$(git_here rev-parse HEAD)
deploy_rerun_if_changed "$before_pull" "$head_sha"
migrations_after=$(git_here rev-parse -q --verify 'HEAD:apps/web/prisma/migrations' || echo none)
if [ -n "${IMAGE_TAG:-}" ]; then
  tags=("$IMAGE_TAG")
else
  tags=("$head_sha")
  code_sha=$(git_here log -1 --first-parent --format=%H HEAD -- . ':(exclude)docs' ':(exclude,glob)*.md')
  [ -z "$code_sha" ] || [ "$code_sha" = "$head_sha" ] || tags+=("$code_sha")
fi

step "pull images"
pulled=
for IMAGE_TAG in "${tags[@]}"; do
  export IMAGE_TAG
  echo "images: $IMAGE_TAG"
  if "${COMPOSE[@]}" pull web api; then pulled=1; break; fi
done
[ -n "$pulled" ] || die "no images tagged ${tags[*]} yet: CI has not finished (or failed) for this commit. Nothing was changed."

# docs/31 B-19: a migration the running web does not have (or an unknown running commit): dump the database first.
dumps=$DEEPSLATE_DATA/backups
if [ "$migrations_before" != "$migrations_after" ] && docker inspect deepslate-db >/dev/null 2>&1; then
  step "dump before the new migration"
  [ "$(id -u)" = 0 ] || die "a new migration is in this deploy and the dump before it needs root"
  pre="$dumps/pre-${head_sha:0:7}-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
  docker exec deepslate-db pg_dump -U deepslate deepslate | gzip > "$pre.part" || { rm -f "$pre.part"; die "the dump before the migration failed; nothing was changed"; }
  [ -s "$pre.part" ] || { rm -f "$pre.part"; die "the dump before the migration is empty; nothing was changed"; }
  mv "$pre.part" "$pre"
  echo "$pre ($(stat -c %s "$pre") bytes)"
fi

step "folders"
[ "$(id -u)" = 0 ] || die "run it as root (sudo): the data folders have four different owners"
# postgres and the dumps: the image's postgres user (70); dist/ and data/: uid 1000 (web and api's user, the modpack
# build writes dist/); geoip and caddy: root (their containers run as root and write them)
install -d -o 70 -g 70 -m 700 "$DEEPSLATE_DATA/postgres"
install -d -o 70 -g 70 -m 755 "$dumps"
install -d -o 1000 -g 1000 -m 755 "$DEEPSLATE_DATA/dist" "$DEEPSLATE_DATA/data" "$DEEPSLATE_DATA/data/branding" "$DEEPSLATE_DATA/data/news" "$DEEPSLATE_DATA/data/builds" "$DEEPSLATE_DATA/data/private-jars"
install -d -o root -g root -m 755 "$DEEPSLATE_DATA/geoip" "$DEEPSLATE_DATA/caddy" "$DEEPSLATE_DATA/caddy/data" "$DEEPSLATE_DATA/caddy/config"
# the deploy key is read by api as uid 1000; a careless `chown -R` over deploy/ takes it away (2026-09-29)
for p in deploy/keys/deploy.key deploy/keys-test/deploy.key; do
  [ -e "$p" ] || continue
  if [ -n "$(find "$p" ! -uid 1000 -print -quit)" ]; then find "$p" -exec chown 1000:1000 {} +; echo "$p given back to uid 1000"; fi
done

# Deepslate Works 3.0: the Windows app, published by CI as a tiny image; copied out into dist/ci/ (never fatal)
step "installer exe"
installer_version=$(tr -d '[:space:]' < installer/VERSION 2>/dev/null || true)
[[ "$installer_version" =~ ^[0-9]{1,4}(\.[0-9]{1,4}){1,3}$ ]] || { echo "installer/VERSION is not a version; falling back to the tag latest"; installer_version=latest; }
INSTALLER_IMAGE="ghcr.io/$(sed -n 's/^GHCR_OWNER=//p' "$ENV_FILE")/deepslate-installer:${INSTALLER_TAG:-$installer_version}"
dist=$DEEPSLATE_DATA/dist
if docker pull -q "$INSTALLER_IMAGE" >/dev/null 2>&1; then
  cid=$(docker create "$INSTALLER_IMAGE" none)
  rm -rf "$dist/ci.new" && mkdir -p "$dist/ci.new"
  if docker cp "$cid:/DeepslateWorks.exe" "$dist/ci.new/" && docker cp "$cid:/DeepslateWorks.exe.sha256" "$dist/ci.new/" && docker cp "$cid:/VERSION" "$dist/ci.new/"; then
    rm -rf "$dist/ci" && mv "$dist/ci.new" "$dist/ci" && chown -R 1000:1000 "$dist/ci"
    echo "DeepslateWorks.exe $(cat "$dist/ci/VERSION") in $dist/ci (run Build -> installer to publish it)"
  else
    rm -rf "$dist/ci.new"; echo "the installer image has no exe; dist/ci left as it was"
  fi
  docker rm "$cid" >/dev/null
else
  echo "no installer image ($INSTALLER_IMAGE) yet; the site keeps what it hands out now"
fi

step "up"
"${COMPOSE[@]}" up -d --remove-orphans
[ "$geoip_on" = 1 ] || { docker inspect deepslate-geoipupdate >/dev/null 2>&1 && { echo "GEOIPUPDATE_ACCOUNT_ID is empty: removing deepslate-geoipupdate"; docker rm -f deepslate-geoipupdate >/dev/null; } || true; }

# docs/35 R-19: backup-loop.sh is mounted as one file; a changed script needs the container restarted
backups_stale=0
want_sum=$(sha256sum deploy/backup-loop.sh | cut -d' ' -f1)
have_sum=$(docker exec deepslate-backups sha256sum /backup-loop.sh 2>/dev/null | cut -d' ' -f1) || have_sum=unreadable
if [ "$have_sum" != "$want_sum" ]; then
  echo "deepslate-backups has another backup-loop.sh (${have_sum:0:12}) than the checkout (${want_sum:0:12}); restarting it"
  "${COMPOSE[@]}" restart backups || backups_stale=1
  have_sum=$(docker exec deepslate-backups sha256sum /backup-loop.sh 2>/dev/null | cut -d' ' -f1) || have_sum=unreadable
  [ "$have_sum" = "$want_sum" ] || backups_stale=1
fi

step "health"
for i in $(seq 1 30); do
  state=$(docker inspect -f '{{.State.Health.Status}}' deepslate-web 2>/dev/null || echo missing)
  [ "$state" = healthy ] && break
  sleep 3
done
[ "$state" = healthy ] || die "deepslate-web is '${state}' after 90 s: docker logs --tail 50 deepslate-web"
for i in $(seq 1 40); do
  api_state=$(docker inspect -f '{{.State.Health.Status}}' deepslate-api 2>/dev/null || echo missing)
  [ "$api_state" = healthy ] && break
  sleep 3
done
[ "$api_state" = healthy ] || die "deepslate-api is '${api_state}' after 120 s: docker logs --tail 50 deepslate-api"
if [[ "$IMAGE_TAG" =~ ^[0-9a-f]{40}$ ]]; then
  for c in deepslate-web deepslate-api; do
    got=$(docker exec "$c" printenv PORTAL_COMMIT 2>/dev/null || echo none)
    [ "$got" = "$IMAGE_TAG" ] || die "$c runs commit '$got', not $IMAGE_TAG"
  done
  echo "web and api both run $IMAGE_TAG"
fi
# with the service token as the key, web's health gives the detail ("tunnel" is the LAN check of the AMP host's sshd)
read_health() { docker exec -e HEALTH_URL="$HEALTH_URL" deepslate-web sh -c 'wget -qO- --header "x-health-key: $API_SERVICE_TOKEN" "$HEALTH_URL"' || true; }
health=$(read_health)
if ! printf '%s' "$health" | grep -q '"api":{"ok":true' && [ "${ALLOW_API_DOWN:-0}" != 1 ]; then
  echo "api does not reach the AMP host yet; waiting up to a minute"
  for i in $(seq 1 6); do
    sleep 10
    health=$(read_health)
    printf '%s' "$health" | grep -q '"api":{"ok":true' && { echo "the AMP host answers after $((i * 10)) s"; break; }
  done
fi
echo "$health"
echo
docker ps --filter name=deepslate- --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
if ! printf '%s' "$health" | grep -q '"api":{"ok":true'; then
  case "$health" in
    *'"amp":"instance_down"'*) echo "amp: instance_down: ADS answers, but the AMP instance is not running. Start it in AMP; the password is not the problem." ;;
    *'"amp":"auth_failed"'*) echo "amp: auth_failed: the AMP instance answers and refuses the login: check AMP_USERNAME and AMP_PASSWORD." ;;
  esac
  [ "${ALLOW_API_DOWN:-0}" = 1 ] || die "the new containers are up, but api does not reach the AMP host (see \"api\" above: tunnel, amp, rsync; the AMP host's rules must admit this host on 8080, 8090, 8100 and 22). Otherwise: docker logs --tail 50 deepslate-api"
  echo "api does not reach the AMP host; accepted (ALLOW_API_DOWN=1)"
fi
# B-23: the AMP host's ssh key is pinned once this file exists; until then api trusts it afresh at each start
amp_host=$(sed -n 's/^AMP_HOST=//p' "$ENV_FILE" | tail -1)
[ -s deploy/keys/known_hosts ] || echo "note: deploy/keys/known_hosts is missing. Make it once, with the AMP host's key:
  docker exec deepslate-api ssh-keyscan -t ed25519 ${amp_host:-<AMP_HOST>} > deploy/keys/known_hosts && chmod 644 deploy/keys/known_hosts
then compare its fingerprint with the AMP host's own (ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub there)."

step "prune old images"
docker image prune -f
[ "$backups_stale" = 0 ] || die "everything else is deployed, but deepslate-backups does not run the checkout's backup-loop.sh: ${COMPOSE[*]} restart backups, then docker logs --tail 20 deepslate-backups"
echo "deployed."
