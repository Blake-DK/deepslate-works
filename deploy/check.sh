#!/usr/bin/env bash
# Typecheck, lint and tests on a host without Node, in a throwaway container with a memory cap.
# The VPS never builds images and never runs anything heavy outside a limit (docs/09).
#
#   deploy/check.sh                 everything
#   deploy/check.sh api             one workspace package (api | web | modpack)
#   deploy/check.sh api test        one step of it (typecheck | lint | test)
#   deploy/check.sh install         refresh node_modules and the lockfile after a dependency change
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."

pkg=${1:-all}
step=${2:-all}
owner_uid=$(stat -c %u .)
owner_gid=$(stat -c %g .)

avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
[ "$avail" -ge 1200 ] || { echo "check: only ${avail} MB available, not starting (need 1200)" >&2; exit 1; }
if docker ps --format '{{.Names}}' | grep -q '^deepslate-check$'; then echo "check: another check is already running" >&2; exit 1; fi

case "$pkg" in
  install) setup='pnpm install --no-frozen-lockfile'; run=':' ;;
  all) setup='pnpm install --frozen-lockfile >/dev/null'; run='pnpm typecheck && pnpm lint && pnpm -r --no-bail test' ;;
  api|web|modpack)
    case "$step" in
      all) setup='pnpm install --frozen-lockfile >/dev/null'; run="pnpm --filter $pkg typecheck && pnpm --filter $pkg lint && pnpm --filter $pkg test" ;;
      typecheck|lint|test) setup='pnpm install --frozen-lockfile >/dev/null'; run="pnpm --filter $pkg $step" ;;
      *) echo "check: unknown step $step" >&2; exit 2 ;;
    esac ;;
  *) echo "check: unknown package $pkg" >&2; exit 2 ;;
esac

exec docker run --rm --name deepslate-check \
  --memory=1500m --memory-swap=2500m --cpus=2 \
  -u "${owner_uid}:${owner_gid}" -e HOME=/tmp -e CI=1 -e NO_COLOR=1 -e npm_config_update_notifier=false \
  -v "$PWD":/app -w /app node:22-alpine sh -c "
    set -e
    npm i -g --prefix /tmp/pnpm pnpm@10 >/dev/null 2>&1
    export PATH=/tmp/pnpm/bin:\$PATH
    $setup
    for app in web api; do
      out=\$(cd apps/\$app && pnpm exec prisma generate 2>&1) || { echo \"\$out\" >&2; echo \"check: prisma generate failed in apps/\$app\" >&2; exit 1; }
    done
    $run
  "
