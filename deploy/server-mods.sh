#!/usr/bin/env bash
# 2.1.0: copies the mod files the server loaded at its last start into modpack/server-loaded.json, which CI compares
# with the lock (`modpack check-sides`). Commit the file afterwards. Read-only: api writes the list (Setting
# "_serverMods") from the server's latest.log at every start, and Sync's check after a restart reads it again; this
# only reads it out of the database.
#
#   deploy/server-mods.sh         the live server's last start (database deepslate)
#   deploy/server-mods.sh test    the test server's (database deepslate_test, docs/42)
#
# 2026-10-20: it used to ask api's /modpack/server-mods as `x-user-id: vps-session`, which answers 403 since admin
# routes read the caller's role from the database (3e508307). There is no "fresh" any more: a start captures the
# list, and so does the check after Sync.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
case "${1:-live}" in
  live) db=deepslate ;;
  test) db=deepslate_test ;;
  *) echo "usage: deploy/server-mods.sh [test]" >&2; exit 2 ;;
esac
out=modpack/server-loaded.json
trap 'rm -f "$out.tmp"' EXIT
raw=$(docker exec deepslate-db psql -U deepslate -d "$db" -tAc "SELECT value FROM \"Setting\" WHERE key = '_serverMods'")
[ -n "$raw" ] || { echo "no capture in $db yet: start the server once" >&2; exit 1; }
printf '%s' "$raw" | python3 -I -c '
import json, sys
v = json.load(sys.stdin)
if not isinstance(v, dict) or not isinstance(v.get("files"), list):
    sys.exit("the capture has no list of files")
for p in v.get("problems") or []:
    print("PROBLEM " + str(p.get("filename")) + ": " + str(p.get("why")), file=sys.stderr)
out = {"at": v.get("at"), "source": v.get("source"), "files": [{"filename": f["filename"], "nested": bool(f.get("nested"))} for f in v["files"]]}
sys.stdout.write(json.dumps(out, indent=2) + "\n")
' > "$out.tmp"
mv "$out.tmp" "$out"
[ "$(id -u)" -eq 0 ] && chown "$(stat -c %u modpack)":"$(stat -c %g modpack)" "$out"
echo "wrote $out from $db: the start at $(grep -m1 '"at"' "$out" | cut -d'"' -f4), $(grep -c '"filename"' "$out") files. Commit it; CI checks it against the lock."
