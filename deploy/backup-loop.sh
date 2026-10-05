#!/bin/sh
# The nightly database dump, run by the `backups` container (deploy/docker-compose.yml).
#
#   deepslate-YYYY-MM-DD.sql.gz in $BACKUP_DIR, the newest $KEEP kept; pre-* dumps are never counted or removed.
#   A failed dump is not kept (.part is renamed only on success, and only when gzip reads it back whole), so it
#   never pushes a good copy out.
#
# docs/31 B-20: the loop used to dump at "container start + n x 24 h", so the hour moved with every restart, and a
# failed dump waited a whole day for the next try. Now: one dump at start when today's is missing, then every day
# at $DUMP_HOUR UTC, and a failed dump is tried again after $RETRY_S seconds. `api` copies the newest dump to the
# AMP host (apps/api/src/backup/dump-push.ts).
#
# ONCE=1 runs one round and exits with the dump's result (the test uses it).
set -u

BACKUP_DIR=${BACKUP_DIR:-/backups}
DUMP_HOUR=${DUMP_HOUR:-0}
KEEP=${KEEP:-14}
RETRY_S=${RETRY_S:-600}

dump() {
  f="$BACKUP_DIR/deepslate-$(date -u +%F).sql.gz"
  # no pipefail in every sh: pg_dump's own exit is kept in a file beside the dump
  { pg_dump -h "${PGHOST:-postgres}" -U "${PGUSER:-deepslate}" "${PGDATABASE:-deepslate}"; echo $? > "$f.rc"; } | gzip > "$f.part"
  rc=$(cat "$f.rc" 2>/dev/null || echo 1)
  rm -f "$f.rc"
  # docs/35 R-08: gzip's own failure (a full disk) is not pg_dump's: the file is read back whole before it is kept,
  # or a cut-off dump would become today's, push a good one out and never be tried again
  zip=ok
  if [ "$rc" = 0 ] && [ -s "$f.part" ] && ! gzip -t "$f.part" 2>/dev/null; then zip=bad; fi
  if [ "$rc" = 0 ] && [ -s "$f.part" ] && [ "$zip" = ok ]; then
    mv "$f.part" "$f"
    echo "$(date -u +%FT%TZ) dumped $(basename "$f") ($(wc -c < "$f") bytes)"
    # newest $KEEP nightly dumps stay; names sort by date
    ls -1 "$BACKUP_DIR"/deepslate-20??-??-??.sql.gz 2>/dev/null | sort -r | tail -n +$((KEEP + 1)) | xargs -r rm -f
    return 0
  fi
  rm -f "$f.part"
  if [ "$zip" = bad ]; then
    echo "$(date -u +%FT%TZ) dump FAILED: gzip did not write it whole (is the disk full?); nothing kept, the older dumps stay"
  else
    echo "$(date -u +%FT%TZ) pg_dump FAILED (exit $rc); nothing kept, the older dumps stay"
  fi
  return 1
}

# seconds from now until the next $DUMP_HOUR:00 UTC
until_next() {
  now=$(date -u +%s)
  today=$((now - now % 86400 + DUMP_HOUR * 3600))
  if [ "$today" -gt "$now" ]; then echo $((today - now)); else echo $((today + 86400 - now)); fi
}

if [ "${ONCE:-0}" = 1 ]; then dump; exit $?; fi

[ -e "$BACKUP_DIR/deepslate-$(date -u +%F).sql.gz" ] || dump || sleep "$RETRY_S"
while true; do
  sleep "$(until_next)"
  until dump; do sleep "$RETRY_S"; done
done
