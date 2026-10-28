#!/bin/sh
# deepslate-db's entrypoint: a copy of the data folder before pgautoupgrade upgrades it in place, then pgautoupgrade.
#
# pgautoupgrade runs pg_upgrade --link and removes the old cluster afterwards, so there is no way back from an upgrade
# but a copy taken before it. The container has only just started, so the cluster is stopped and a file copy of it is
# whole. The newest $PRE_UPGRADE_KEEP copies stay in $PRE_UPGRADE_DIR (its own mount, outside /var/lib/postgresql:
# pgautoupgrade moves everything at the top of that folder into its work folder).
#
# It also refuses to start where pgautoupgrade would make an empty database next to the real one: from 18 on, the data
# is in /var/lib/postgresql/<major>/docker, and pgautoupgrade 18 looks only in its own major's folder and, for the move
# from the old layout, at the top of /var/lib/postgresql. Data anywhere else stops the start, with the reason.
set -eu

ROOT=/var/lib/postgresql
PRE=${PRE_UPGRADE_DIR:-/pre-upgrade}
KEEP=${PRE_UPGRADE_KEEP:-2}
target=${PG_MAJOR:?the image sets PG_MAJOR}

die() { echo "deepslate-db: $*" >&2; exit 1; }

# where the data is now: this major's folder, the layout before 18 (PG_VERSION at the top) or another major's folder
src=
if [ -s "$PGDATA/PG_VERSION" ]; then
  src=$PGDATA
elif [ -s "$ROOT/PG_VERSION" ]; then
  src=$ROOT
  [ "$target" = 18 ] || die "the data is in the layout from before PostgreSQL 18 (at the top of $ROOT), and only the 18 image moves it. Nothing was changed."
else
  for d in "$ROOT"/*/docker; do
    [ -s "$d/PG_VERSION" ] || continue
    die "the data is in $d (PostgreSQL $(cat "$d/PG_VERSION")), and this image ($target) would start an empty database in $PGDATA instead of upgrading it. Nothing was changed."
  done
fi

if [ -n "$src" ]; then
  have=$(cat "$src/PG_VERSION")
  if [ "$have" != "$target" ]; then
    stamp=$(date -u +%Y%m%dT%H%M%SZ)
    dest="$PRE/pg$have-$stamp"
    echo "deepslate-db: PostgreSQL $have data, image $target: copying $src to $dest before the upgrade"
    mkdir -p "$PRE"
    rm -rf "$PRE"/*.part
    mkdir "$dest.part"
    # the top level of the old layout may already hold an empty major folder from an earlier start; data folders
    # never have a name that starts with a digit
    find "$src" -mindepth 1 -maxdepth 1 ! -name '[0-9]*' -exec cp -a {} "$dest.part/" \;
    [ -s "$dest.part/PG_VERSION" ] || die "the copy in $dest.part has no PG_VERSION; nothing was upgraded"
    mv "$dest.part" "$dest"
    echo "deepslate-db: copied ($(du -sh "$dest" | cut -f1))"
    # newest $KEEP copies stay; the names sort by time after the version, so by modification time
    ls -1dt "$PRE"/pg* 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do rm -rf "$old"; done
  fi
fi

exec /usr/local/bin/docker-entrypoint.sh "$@"
