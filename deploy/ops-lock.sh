# Sourced by deploy/deploy.sh and the VPS's api.sh: one pack-or-deploy job at a time on this host, and the caller named.
# 2026-10-03: two sessions deployed, built and synced at once and api's log showed both as "vps-session".
#
#   ops_caller                 who is calling: $DEEPSLATE_CALLER, else the session's job id (from JOB_DIR, .../jobs/<id>),
#                              both looked up through the parent processes because sudo drops the environment, else the tty
#   ops_lock <what>            takes the lock for this shell's life, or prints "busy, held by <id> since <time> (<what>)"
#                              and returns 75

OPS_LOCK=${OPS_LOCK:-/root/docker/deepslate/ops.lock}
OPS_HOLDER=${OPS_HOLDER:-/root/docker/deepslate/ops.holder}

ops_caller() {
  [ -n "${DEEPSLATE_CALLER:-}" ] && { echo "$DEEPSLATE_CALLER"; return; }
  local pid=$$ env job
  while [ -n "$pid" ] && [ "$pid" -gt 1 ]; do
    env=$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null) || env=""
    job=$(printf '%s\n' "$env" | sed -n 's/^DEEPSLATE_CALLER=//p' | head -1)
    [ -n "$job" ] && { echo "$job"; return; }
    job=$(printf '%s\n' "$env" | sed -n 's|^JOB_DIR=.*/jobs/\([^/]*\).*|\1|p' | head -1)
    [ -n "$job" ] && { echo "vps-session-$job"; return; }
    pid=$(awk '{print $4}' "/proc/$pid/stat" 2>/dev/null)
  done
  local t; t=$(ps -o tty= -p $$ 2>/dev/null | tr -d ' ' | tr '/' '-')
  if [ -n "$t" ] && [ "$t" != "?" ]; then echo "vps-session-$t"; else echo "vps-session-pid$PPID"; fi
}

ops_lock() {
  local what=$1 me; me=$(ops_caller)
  mkdir -p "$(dirname "$OPS_LOCK")"
  exec 9>>"$OPS_LOCK"
  if ! flock -n 9; then
    echo "busy, held by $(cat "$OPS_HOLDER" 2>/dev/null || echo 'an unnamed caller')" >&2
    return 75
  fi
  echo "$me since $(date -u '+%Y-%m-%d %H:%M:%S UTC') ($what)" > "$OPS_HOLDER"
  trap ': > "$OPS_HOLDER"' EXIT
}
