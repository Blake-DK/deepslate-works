#!/bin/sh
# The stack's `init` service (deploy/home/docker-compose.yml): the data folders with their owners, once per redeploy and
# before anything else starts. What deploy/home/deploy.sh's "folders" step did. Runs as root with CHOWN, FOWNER and
# DAC_OVERRIDE only, and no network.
#
#   /data        DEEPSLATE_DATA                       /keys, /keys-test   deploy/keys and deploy/keys-test of the checkout
#   /test        TEST_DIR (the `init-test` service, profile `test`)
#
# postgres and the dumps: the image's postgres user (70); dist/ and data/: uid 1000 (api's user, the modpack build
# writes dist/); geoip and caddy: root (their containers run as root and write them).
set -eu

if [ -d /data ]; then
  install -d -o 70 -g 70 -m 700 /data/postgres /data/postgres-pre-upgrade
  # 755: api reads the dumps as uid 1000
  install -d -o 70 -g 70 -m 755 /data/backups
  install -d -o 1000 -g 1000 -m 755 /data/dist /data/data /data/data/branding /data/data/news /data/data/builds /data/data/private-jars
  install -d -o 0 -g 0 -m 755 /data/geoip /data/caddy /data/caddy/data /data/caddy/config
  echo "init: data folders in place"
fi

# api reads the deploy keys as uid 1000; a careless `chown -R` over deploy/ takes them away (2026-09-29)
for k in /keys/deploy.key /keys-test/deploy.key; do
  [ -e "$k" ] || continue
  if [ "$(stat -c %u "$k")" != 1000 ]; then chown 1000:1000 "$k"; echo "init: ${k#/} given back to uid 1000"; fi
done

# docs/42: the test checkout. api-test writes its dist/ as uid 1000 (a Build); web-test writes data/ as the checkout's owner.
if [ -d /test ]; then
  owner=$(stat -c %u:%g /test)
  install -d -o 1000 -g 1000 /test/dist
  for d in data data/branding data/news data/builds data/private-jars; do
    [ -d "/test/$d" ] || { install -d -o "${owner%:*}" -g "${owner#*:}" "/test/$d"; echo "init: made $d in the test checkout"; }
  done
  echo "init: test checkout folders in place"
fi
