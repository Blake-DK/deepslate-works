#!/usr/bin/env bash
# docs/42 §5.3: brings the test server's checkout to origin/dev and prints the commit. Run it as ladm, the checkout's
# owner (as root it switches to the owner, so root never leaves files in that .git).
#
#   deploy/test-pull.sh                   the checkout at /home/ladm/Minecraft-site-test
#   deploy/test-pull.sh /path/to/checkout another one
#
# Only a fast-forward: a checkout with local commits or changes, or on another branch, is left as it is and named.
# New pack or season files are then on the test site at once (they are read from the checkout); new code needs new
# images (CI builds `dev` on a push, the workflow dev-images; then sudo deploy/test-up.sh).
set -euo pipefail
dir=${1:-${TEST_DIR:-/home/ladm/Minecraft-site-test}}
die() { echo "test-pull: $*" >&2; exit 1; }
[ -d "$dir/.git" ] || die "$dir is not a checkout. Make it once, as ladm: git clone -b dev https://github.com/Blake-DK/deepslate-works.git $dir"
owner=$(stat -c %U "$dir")
if [ "$(id -u)" = 0 ] && [ "$owner" != root ]; then exec runuser -u "$owner" -- "$0" "$dir"; fi
# its .git is mounted into no container read-write, but no hook or fsmonitor of it runs here either
g() { git -C "$dir" -c core.hooksPath=/dev/null -c core.fsmonitor= "$@"; }
# 2026-10-09: a checkout can be held at a commit on purpose (the rehearsal of a pack change runs a pack dev no longer
# has). The hold is a file in its .git, never committed: remove it to pull again.
if [ -f "$dir/.git/deepslate-hold" ]; then die "$dir is held on purpose: $(head -c 300 "$dir/.git/deepslate-hold"). Remove $dir/.git/deepslate-hold to pull. Nothing was changed."; fi
[ "$(g branch --show-current)" = dev ] || die "$dir is on '$(g branch --show-current)', not dev. Nothing was changed."
[ -z "$(g status --porcelain --untracked-files=no)" ] || die "$dir has local changes (git -C $dir status). Nothing was changed."
before=$(g rev-parse HEAD)
g fetch -q origin dev
ahead=$(g log --format='  %h %s' origin/dev..HEAD)
[ -z "$ahead" ] || die "$dir has commits that are not on origin/dev:
$ahead
Nothing was changed."
g merge -q --ff-only origin/dev
after=$(g rev-parse HEAD)
if [ "$before" = "$after" ]; then echo "test checkout already at $(g log -1 --format='%h %s')"; else echo "test checkout ${before:0:7} -> $(g log -1 --format='%h %s')"; fi
echo "$after"
