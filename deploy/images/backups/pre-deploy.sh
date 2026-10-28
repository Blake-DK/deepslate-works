#!/bin/sh
# The stack's `db-prep` service (deploy/home/docker-compose.yml), once per redeploy, after the database is up and before
# the migrations: a dump of the database first (docs/31 B-19: there is no way back from a migration but a dump taken
# before it), and the test database made when the test server is on and it is missing (docs/42 §5.2).
#
#   pre-deploy-YYYYMMDDTHHMMSSZ.sql.gz in $BACKUP_DIR, the newest $KEEP_PRE kept. The nightly loop counts and removes
#   only deepslate-YYYY-MM-DD dumps, and api copies only those to the AMP host, so these are left to this script.
#
# A dump that fails stops the redeploy before the migrations (exit 1): web and api then stay down until it is fixed,
# which beats a migration with no dump to go back to.
set -u

BACKUP_DIR=${BACKUP_DIR:-/backups}
KEEP_PRE=${KEEP_PRE:-10}
db=${PGDATABASE:-deepslate}

if [ "${ENSURE_TEST_DB:-0}" = 1 ]; then
  have=$(psql -d "$db" -tAc "SELECT 1 FROM pg_database WHERE datname = 'deepslate_test'") || { echo "db-prep: cannot ask the database whether deepslate_test exists" >&2; exit 1; }
  if [ "$have" != 1 ]; then
    createdb -O "${PGUSER:-deepslate}" deepslate_test || { echo "db-prep: could not make the database deepslate_test" >&2; exit 1; }
    echo "db-prep: made the database deepslate_test"
  fi
fi

f="$BACKUP_DIR/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
# no pipefail in every sh: pg_dump's own exit is kept in a file beside the dump
{ pg_dump -d "$db"; echo $? > "$f.rc"; } | gzip > "$f.part"
rc=$(cat "$f.rc" 2>/dev/null || echo 1)
rm -f "$f.rc"
if [ "$rc" != 0 ] || [ ! -s "$f.part" ] || ! gzip -t "$f.part" 2>/dev/null; then
  rm -f "$f.part"
  echo "db-prep: the dump before the migrations FAILED (pg_dump exit $rc, or gzip could not write it whole: is the disk full?). The migrations do not run, so web and api do not start." >&2
  exit 1
fi
mv "$f.part" "$f"
echo "db-prep: dumped $(basename "$f") ($(wc -c < "$f") bytes)"
ls -1 "$BACKUP_DIR"/pre-deploy-*.sql.gz 2>/dev/null | sort -r | tail -n +$((KEEP_PRE + 1)) | xargs -r rm -f
