#!/usr/bin/env bash
# docs/42: starts the test server's copy of the site, web-test and api-test, or puts them on new images.
#
#   sudo deploy/test-up.sh     pull the images tagged TEST_IMAGE_TAG (default `dev`: CI builds it on every push to dev
#                              that changes an image, .github/workflows/dev-images.yml), make the database
#                              deepslate_test if it is missing, start both, and print the commit the test site is now on
#
# The test site follows dev, the live site follows main (2026-10-10). Another ref on the test site: run the workflow
# test-images for it (tag `test` and its commit), set TEST_IMAGE_TAG=test in deploy/.env, run this; set it back to dev
# (or remove the line) to follow dev again.
#
# deploy.sh runs it too (without the pull) while TEST_STACK=1. The live containers are never touched here: the two are
# started without their dependencies (--no-deps), web-test first, as its start applies the test database's migrations.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")/.."
if [ -z "${TEST_UP_FROM_DEPLOY:-}" ]; then
  . deploy/ops-lock.sh
  ops_lock test-up || exit 75
fi
die() { echo "test-up: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run it as root (sudo): it makes the test database and gives the test dist/ to uid 1000"
[ -f deploy/.env ] || die "deploy/.env is missing"
. deploy/test-env.sh
grep -Eq '^TEST_STACK=1$' deploy/.env || die "TEST_STACK=1 is not in deploy/.env, so the test server is off. Nothing was started."
test_env_check || die "the test server's lines in deploy/.env are not complete (above). Nothing was started."
COMPOSE=(docker compose -f deploy/docker-compose.yml --env-file deploy/.env --profile test)
TEST_DIR=$(envval TEST_DIR)
owner=$(stat -c %U "$TEST_DIR")

[ "$(docker inspect -f '{{.State.Running}}' deepslate-db 2>/dev/null)" = true ] || die "deepslate-db is not running: deploy the live stack first (sudo deploy/deploy.sh)"
[ "$(docker inspect -f '{{.State.Running}}' deepslate-wg 2>/dev/null)" = true ] || die "deepslate-wg (the tunnel) is not running: deploy the live stack first"

avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
echo "memory: ${avail} MB available; the test pair may take up to 896 MB"
[ "$avail" -ge 1000 ] || die "only ${avail} MB available: the test pair needs up to 896 MB. See what is using it: docker stats --no-stream"

# api-test writes the test dist/ as uid 1000 (a Build); web-test (the checkout's owner) writes data/
if [ "$(stat -c %u "$TEST_DIR/dist" 2>/dev/null || echo none)" != 1000 ]; then
  mkdir -p "$TEST_DIR/dist" && chown -R 1000:1000 "$TEST_DIR/dist"
  echo "$TEST_DIR/dist now belongs to uid 1000"
fi
for d in data data/branding data/news data/builds; do
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
  # compose honours that on a pull too, so a `test` tag already on the host was never refreshed (2026-10-08: the test
  # pair kept running the morning's images after two runs of test-images). `up` below recreates a container whose
  # image changed.
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
[ "$images" = "$checkout" ] || echo "note: the images and the checkout are different commits. The images are tag ${tag}; the checkout holds the pack and season files (deploy/test-pull.sh as ladm, unless it is held)"
echo "the test site is now on ${images} (tag ${tag})"
[ -s deploy/keys-test/known_hosts ] || echo "note: deploy/keys-test/known_hosts is missing; copy the live one (the same AMP host): cp deploy/keys/known_hosts deploy/keys-test/known_hosts"
docker ps --filter name=deepslate- --filter name=test --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
