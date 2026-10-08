#!/usr/bin/env bash
# docs/42 §5.2: drops the test server's database and makes it again, empty. Everything the test site knew goes: its
# users and invites (Alex's Discord sign-in makes him its admin again), seasons, sessions, settings. The test
# server's world is not touched.
#
#   sudo deploy/test-db-reset.sh deepslate_test     the name is the confirmation; any other name is refused
#
# web-test and api-test are stopped first and started again after (web-test applies the migrations at its start).
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
. deploy/ops-lock.sh
ops_lock test-db-reset || exit 75
die() { echo "test-db-reset: $*" >&2; exit 1; }
[ "${1:-}" = deepslate_test ] || die "give the database's name to confirm: sudo deploy/test-db-reset.sh deepslate_test (it refuses any other)"
[ "$(id -u)" = 0 ] || die "run it as root (sudo)"
db=deepslate_test
[ "$(docker inspect -f '{{.State.Running}}' deepslate-db 2>/dev/null)" = true ] || die "deepslate-db is not running"
for c in deepslate-api-test deepslate-web-test; do
  docker inspect "$c" >/dev/null 2>&1 && docker stop "$c" >/dev/null && echo "stopped $c"
done
docker exec deepslate-db dropdb -U deepslate --if-exists --force "$db"
docker exec deepslate-db createdb -U deepslate -O deepslate "$db"
echo "the database $db is empty again"
if grep -Eq '^TEST_STACK=1$' deploy/.env; then
  TEST_UP_FROM_DEPLOY=1 TEST_UP_PULL=0 deploy/test-up.sh
else
  echo "TEST_STACK is not 1 in deploy/.env: the test pair stays stopped"
fi
