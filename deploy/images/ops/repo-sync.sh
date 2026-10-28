#!/bin/sh
# The stack's `repo-sync` services (deploy/home/docker-compose.yml): bring a checkout forward to the branch it follows,
# once per redeploy, before the services that read it start. What deploy/home/deploy.sh's "git pull" step and
# deploy/test-pull.sh did. Runs as the checkout's owner (uid 1000) with no Linux capabilities.
#
#   /repo                  the checkout (DEEPSLATE_DIR, or TEST_DIR for `repo-sync-test`)
#   SYNC_BRANCHES          the branches it may follow ("main dev" live, "dev" for the test checkout)
#   GIT_CONFIG_EXPECTED    \  the copies of .git/config and of the hooks' sha256 that web cannot reach (deploy/README.md);
#   GIT_HOOKS_EXPECTED     /  unset for the test checkout, whose .git no container can write
#
# It never stops the stack. In compose a service that fails leaves the services after it created and not started,
# with their old containers already removed: the site would be down for a checkout that cannot move. So whatever it
# refuses, it says why and exits 0, and the stack starts on the checkout as it was.
set -u
. /usr/local/lib/deepslate/git-guard.sh

REPO=${REPO:-/repo}
export HOME=${HOME:-/tmp}
# web can write the live checkout's .git (Admin -> Lock commits there): no hooks, no fsmonitor, no ssh command
g() { git -C "$REPO" -c core.hooksPath=/dev/null -c core.fsmonitor= -c core.sshCommand= "$@"; }
left() { echo "repo-sync: $*"; echo "repo-sync: the checkout was LEFT AS IT WAS; the stack starts on $(g log -1 --format='%h %s' 2>/dev/null || echo 'it')"; exit 0; }

[ -d "$REPO/.git" ] || left "$REPO is not a checkout."
# 2026-10-09: a checkout can be held at a commit on purpose; the hold is a file in its .git, never committed
[ ! -f "$REPO/.git/deepslate-hold" ] || left "it is held on purpose: $(head -c 300 "$REPO/.git/deepslate-hold"). Remove .git/deepslate-hold to let it move."

if [ -n "${GIT_CONFIG_EXPECTED:-}" ]; then
  [ -f "$GIT_CONFIG_EXPECTED" ] && [ -s "$GIT_CONFIG_EXPECTED" ] || left "$GIT_CONFIG_EXPECTED is missing (deploy/README.md: read .git/config by eye, then save the copy)."
  sort "$GIT_CONFIG_EXPECTED" > /tmp/config.want
  g config --local --list | sort > /tmp/config.now
  config_diff=$(diff /tmp/config.want /tmp/config.now)
  [ -z "$config_diff" ] || left ".git/config is not the copy in $GIT_CONFIG_EXPECTED:
$config_diff
Look at .git/config. Update the copy only if the change is yours."
fi
if [ -n "${GIT_HOOKS_EXPECTED:-}" ]; then
  [ -f "$GIT_HOOKS_EXPECTED" ] && [ -s "$GIT_HOOKS_EXPECTED" ] || left "$GIT_HOOKS_EXPECTED is missing (deploy/README.md: read each hook by eye, then save the list)."
  hooks_diff=$(git_hooks_problems "$REPO/.git/hooks" "$GIT_HOOKS_EXPECTED")
  [ -z "$hooks_diff" ] || left ".git/hooks is not what $GIT_HOOKS_EXPECTED lists:
$hooks_diff
Look at .git/hooks. Update the list only if the change is yours."
fi
# asked without g's own -c, which would answer /dev/null
hooks_path=$(git -C "$REPO" config --local --get-all core.hooksPath)
[ -z "$hooks_path" ] || left "core.hooksPath is set in .git/config ($hooks_path), so git would run hooks from another folder."

upstream=$(g rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)
branch=${upstream#origin/}
case " ${SYNC_BRANCHES:-main dev} " in
  *" $branch "*) [ "$upstream" = "origin/$branch" ] || left "it follows '${upstream:-no branch}', not origin/$branch." ;;
  *) left "it follows '${upstream:-no branch}', not one of origin/{${SYNC_BRANCHES:-main dev}}." ;;
esac

before=$(g rev-parse HEAD)
g fetch -q origin "$branch" || left "the fetch of origin/$branch failed (above)."
# commits made here (Admin -> Lock and Apply results commit inside web, and never push) reach the branch first
unpushed=$(g log --format='  %h %s' "$upstream..HEAD")
[ -z "$unpushed" ] || left "it has commits that are not on $upstream:
$unpushed
Push them as a branch, open a PR, merge it, then redeploy."
g merge -q --ff-only "$upstream" || left "it cannot be fast-forwarded to $upstream (local changes in the way? git status)."
after=$(g rev-parse HEAD)
if [ "$before" = "$after" ]; then
  echo "repo-sync: already at $(g log -1 --format='%h %s')"
else
  echo "repo-sync: $(echo "$before" | cut -c1-7) -> $(g log -1 --format='%h %s')"
fi
