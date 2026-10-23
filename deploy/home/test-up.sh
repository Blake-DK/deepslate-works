#!/usr/bin/env bash
# docs/42 on docker-01v: starts the test server's copy of the site, web-test and api-test, or puts them on new images.
#
#   sudo deploy/home/test-up.sh   pull the images tagged TEST_IMAGE_TAG (default `dev`: CI builds it on every push to
#                                 dev that changes an image, .github/workflows/dev-images.yml), make the database
#                                 deepslate_test if it is missing, start both, and print the commit the test site is on
#
# The test site follows dev, the live site follows main. Another ref on the test site: run the workflow test-images
# for it (tag `test` and its commit), set TEST_IMAGE_TAG=test in deploy/home/.env, run this; set it back to dev (or
# remove the line) to follow dev again. The test checkout (TEST_DIR, on dev, the deploy user's) holds the pack and
# season files the test site reads: deploy/test-pull.sh <TEST_DIR>, as that user, brings it forward.
#
# deploy/home/deploy.sh runs it too (without the pull) while TEST_STACK=1. The live containers are never touched here:
# the two are started without their dependencies (--no-deps), web-test first, as its start applies the test database's
# migrations. Derived from deploy/test-up.sh (the VPS, 2026-10-23): the home compose file and env, no tunnel to wait for.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")/../.."
ENV_FILE=deploy/home/.env
die() { echo "test-up: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run it as root (sudo): it makes the test database and gives the test dist/ to uid 1000"
[ -f "$ENV_FILE" ] || die "$ENV_FILE is missing"
DEEPSLATE_DATA=$(sed -n 's/^DEEPSLATE_DATA=//p' "$ENV_FILE" | tail -1)
[[ "$DEEPSLATE_DATA" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "set DEEPSLATE_DATA in $ENV_FILE (absolute path of the data root)"
if [ -z "${TEST_UP_FROM_DEPLOY:-}" ]; then
  # one deploy, build or sync at a time on this host (deploy/ops-lock.sh); the lock lives with the data
  OPS_LOCK=$DEEPSLATE_DATA/ops.lock OPS_HOLDER=$DEEPSLATE_DATA/ops.holder
  . deploy/ops-lock.sh
  ops_lock test-up || exit 75
fi
export ENV_FILE
. deploy/test-env.sh
grep -Eq '^TEST_STACK=1$' "$ENV_FILE" || die "TEST_STACK=1 is not in $ENV_FILE, so the test server is off. Nothing was started."
test_env_check || die "the test server's lines in $ENV_FILE are not complete (above). Nothing was started."
COMPOSE=(docker compose -f deploy/home/docker-compose.yml --env-file "$ENV_FILE" --profile test)
TEST_DIR=$(envval TEST_DIR)
owner=$(stat -c %U "$TEST_DIR")

[ "$(docker inspect -f '{{.State.Running}}' deepslate-db 2>/dev/null)" = true ] || die "deepslate-db is not running: deploy the live stack first (sudo deploy/home/deploy.sh)"

avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
echo "memory: ${avail} MB available; the test pair may take up to 896 MB"
[ "$avail" -ge 1000 ] || die "only ${avail} MB available: the test pair needs up to 896 MB. See what is using it: docker stats --no-stream"

# api-test writes the test dist/ as uid 1000 (a Build); web-test (the checkout's owner) writes data/
if [ "$(stat -c %u "$TEST_DIR/dist" 2>/dev/null || echo none)" != 1000 ]; then
  mkdir -p "$TEST_DIR/dist" && chown -R 1000:1000 "$TEST_DIR/dist"
  echo "$TEST_DIR/dist now belongs to uid 1000"
fi
for d in data data/branding data/news data/builds data/private-jars; do
  [ -d "$TEST_DIR/$d" ] || { mkdir -p "$TEST_DIR/$d"; chown "$owner": "$TEST_DIR/$d"; echo "made $TEST_DIR/$d"; }
done
# the test deploy key is read by api-test as uid 1000, as the live one is
if [ -e deploy/keys-test/deploy.key ] && [ -n "$(find deploy/keys-test/deploy.key ! -uid 1000 -print -quit)" ]; then
  chown 1000:1000 deploy/keys-test/deploy.key && echo "deploy/keys-test/deploy.key given to uid 1000"
fi

# docs/42 §5.2: the test database, in the live Postgres, owned by the same role; never in the nightly dumps
have=$(docker exec deepslate-db psql -U deepslate -d deepslate -tAc "SELECT 1 FROM pg_database WHERE datname = 'deepslate_test'")
if [ "$have" != 1 ]; then
  docker exec deepslate-db createdb -U deepslate -O deepslate deepslate_test
  echo "made the database deepslate_test"
fi

tag=$(envval TEST_IMAGE_TAG); tag=${tag:-dev}
if [ "${TEST_UP_PULL:-1}" = 1 ]; then
  echo "images: deepslate-web and deepslate-api tagged $tag"
  # docker pull, not `compose pull`: the two services have pull_policy: missing (a live deploy never waits on them), and
  # compose honours that on a pull too, so a tag already on the host would never be refreshed. `up` below recreates a
  # container whose image changed.
  owner_gh=$(envval GHCR_OWNER)
  for svc in web api; do
    if [ "$tag" = dev ]; then hint="CI makes it on a push to dev that changes an image: wait for Actions → dev-images to finish"
    else hint="run the workflow test-images on GitHub (Actions → test-images → Run workflow)"; fi
    docker pull -q "ghcr.io/${owner_gh}/deepslate-${svc}:${tag}" >/dev/null || die "no image deepslate-${svc}:${tag}: ${hint}, then this again"
  done
fi

wait_healthy() {
  local c=$1 tries=$2 s
  for _ in $(seq 1 "$tries"); do
    s=$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null || echo missing)
    [ "$s" = healthy ] && return 0
    sleep 3
  done
  echo "test-up: $c is '$s': docker logs --tail 50 $c" >&2
  return 1
}
TEST_IMAGE_TAG=$tag "${COMPOSE[@]}" up -d --no-deps web-test
wait_healthy deepslate-web-test 40 || exit 1
TEST_IMAGE_TAG=$tag "${COMPOSE[@]}" up -d --no-deps api-test
wait_healthy deepslate-api-test 40 || exit 1

# docs/42 §5.3: what the test site runs, and a warning when the images and the checkout are not the same commit
images=$(docker exec deepslate-api-test printenv PORTAL_COMMIT 2>/dev/null || echo unknown)
web_images=$(docker exec deepslate-web-test printenv PORTAL_COMMIT 2>/dev/null || echo unknown)
[ "$web_images" = "$images" ] || echo "test-up: web-test runs ${web_images:0:12} and api-test ${images:0:12}: the tag $tag moved between the two pulls; run this again" >&2
checkout=$(runuser -u "$owner" -- git -C "$TEST_DIR" -c core.hooksPath=/dev/null -c core.fsmonitor= rev-parse HEAD 2>/dev/null || echo unknown)
echo "test server up: images ${images:0:12}, checkout ${checkout:0:12}"
[ "$images" = "$checkout" ] || echo "note: the images and the checkout are different commits. The images are tag ${tag}; the checkout holds the pack and season files (deploy/test-pull.sh $TEST_DIR as $owner, unless it is held)"
echo "the test site is now on ${images} (tag ${tag})"
[ -s deploy/keys-test/known_hosts ] || echo "note: deploy/keys-test/known_hosts is missing; copy the live one (the same AMP host): cp deploy/keys/known_hosts deploy/keys-test/known_hosts"
docker ps --filter name=deepslate- --filter name=test --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
