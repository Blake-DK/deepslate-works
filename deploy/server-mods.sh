#!/usr/bin/env bash
# 2.1.0: copies the mod files the server loaded at its last start (api Setting "_serverMods", captured from the
# server's latest.log at every start) into modpack/server-loaded.json, which CI compares with the lock
# (`modpack check-sides`). Commit the file afterwards. Read-only on the server side.
#
#   sudo deploy/server-mods.sh          what api captured at the last start
#   sudo deploy/server-mods.sh fresh    read the server's latest.log again now (the server must have started since)
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
q=""; [ "${1:-}" = "fresh" ] && q="?fresh=1"
out=modpack/server-loaded.json
docker exec deepslate-api node -e '
(async()=>{const r=await fetch("http://127.0.0.1:4000/modpack/server-mods"+process.argv[1],{headers:{authorization:"Bearer "+process.env.API_SERVICE_TOKEN,"x-user-role":"ADMIN","x-user-id":"vps-session"}});
 if(!r.ok){console.error("api: HTTP "+r.status);process.exit(1)}
 const v=await r.json(); if(!v||!Array.isArray(v.files)){console.error("api has no capture yet: start the server once (or run with fresh after a start)");process.exit(1)}
 for(const p of v.problems||[]) console.error("PROBLEM "+p.filename+": "+p.why);
 process.stdout.write(JSON.stringify({at:v.at,source:v.source,files:v.files.map(f=>({filename:f.filename,nested:!!f.nested}))},null,2)+"\n")})()' "$q" > "$out.tmp"
mv "$out.tmp" "$out"
chown "$(stat -c %u modpack)":"$(stat -c %g modpack)" "$out"
echo "wrote $out ($(grep -c '"filename"' "$out") files). Commit it; CI checks it against the lock."
