#!/usr/bin/env bash
# After a redeploy of the stack: the one-shot steps' logs saved to one file, then their containers removed.
#
# Run every two minutes by deepslate-step-cleanup.timer on the host, as the checkout's owner (in the docker group): the
# stack itself has no Docker socket and keeps it that way. A step is a container of the project whose restart policy is
# "no" (init, repo-sync, installer, db-prep, migrate and the test pair's). Nothing is done while any step has not exited,
# within SETTLE_S of the last one ending (compose may still be at work), or when any step exited with other than 0:
# then every step is left in place, to be looked at with `docker logs deepslate-<step>`.
#
#   LOG_DIR    where the files go, one per redeploy: redeploy-<first step's start, UTC>.log (required)
#   KEEP       how many files are kept, newest first (10)
#   SETTLE_S   seconds since the last step ended before anything is touched (180)
#   PROJECT    the compose project (deepslate)
#   DRY_RUN=1  the file is written, nothing is removed
set -euo pipefail

LOG_DIR=${LOG_DIR:?LOG_DIR is where the step logs go}
KEEP=${KEEP:-10}
SETTLE_S=${SETTLE_S:-180}
PROJECT=${PROJECT:-deepslate}
DRY_RUN=${DRY_RUN:-0}

mapfile -t ids < <(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")
[ ${#ids[@]} -gt 0 ] || exit 0

# id, restart policy, status, exit code, started, finished, name: one line per container
mapfile -t steps < <(docker inspect -f '{{.Id}} {{.HostConfig.RestartPolicy.Name}} {{.State.Status}} {{.State.ExitCode}} {{.State.StartedAt}} {{.State.FinishedAt}} {{.Name}}' "${ids[@]}" | awk '$2 == "no"' | sort -k5)
[ ${#steps[@]} -gt 0 ] || exit 0

newest=0
for s in "${steps[@]}"; do
  read -r _ _ status code _ finished name <<<"$s"
  [ "$status" = exited ] || exit 0
  if [ "$code" != 0 ]; then
    echo "${name#/} exited with $code: every step left in place"
    exit 0
  fi
  t=$(date -d "$finished" +%s)
  [ "$t" -gt "$newest" ] && newest=$t
done
[ $(($(date +%s) - newest)) -ge "$SETTLE_S" ] || exit 0

read -r _ _ _ _ first _ _ <<<"${steps[0]}"
file="$LOG_DIR/redeploy-$(date -u -d "$first" +%Y%m%d-%H%M%SZ).log"
mkdir -p "$LOG_DIR"
{
  for s in "${steps[@]}"; do
    read -r id _ _ code started finished name <<<"$s"
    echo "== ${name#/}  exit $code  started $started  finished $finished"
    docker logs --timestamps "$id" 2>&1
    echo
  done
} >"$file.part"
mv "$file.part" "$file"
if [ "$DRY_RUN" = 1 ]; then
  echo "${#steps[@]} steps saved to $file (dry run: nothing removed)"
  exit 0
fi

for s in "${steps[@]}"; do
  read -r id _ _ _ _ _ name <<<"$s"
  docker rm "$id" >/dev/null
done
echo "${#steps[@]} steps saved to $file and removed"

ls -1t "$LOG_DIR"/redeploy-*.log | tail -n +$((KEEP + 1)) | xargs -r rm --
