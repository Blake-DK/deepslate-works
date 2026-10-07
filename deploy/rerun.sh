# Sourced by deploy/deploy.sh before its git pull. A deploy runs the copy of deploy.sh it started with, so a pull
# that changes deploy.sh (or a file it sources) went on with the old steps against the new tree: on 2026-10-07 the
# first deploy of the build designer did not start the designer the new compose file expected, and web stayed
# unhealthy. After the pull, the new script is run instead, once.
#
# Before it runs, the .git/config and .git/hooks checks run again with the functions loaded before the pull
# (check_git_guards in deploy.sh), so nothing from the pulled tree runs until they pass. The new script keeps the
# deploy lock it inherits (OPS_LOCK_INHERITED, deploy/ops-lock.sh), and DEEPSLATE_DEPLOY_RERUN stops it from
# running itself again. Plain sh and busybox, so the tests run it as it is.

DEPLOY_SELF_FILES="deploy/deploy.sh deploy/git-guard.sh deploy/ops-lock.sh deploy/rerun.sh"

# deploy_rerun_if_changed <commit before the pull> <commit after it>
deploy_rerun_if_changed() {
  [ "$1" != "$2" ] || return 0
  # shellcheck disable=SC2086 # the list is ours, without spaces
  rerun_changed=$(git_here diff --name-only "$1" "$2" -- $DEPLOY_SELF_FILES | tr '\n' ' ')
  [ -n "$rerun_changed" ] || return 0
  if [ -n "${DEEPSLATE_DEPLOY_RERUN:-}" ]; then
    echo "deploy: this is already the pulled deploy.sh; not running it again"
    return 0
  fi
  check_git_guards
  echo "deploy: the pull changed ${rerun_changed}so the new deploy.sh runs now"
  DEEPSLATE_DEPLOY_RERUN=1 OPS_LOCK_INHERITED=1 exec ${DEPLOY_SHELL:-bash} "${DEPLOY_SCRIPT:-deploy/deploy.sh}"
}
