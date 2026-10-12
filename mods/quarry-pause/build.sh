#!/usr/bin/env bash
# Builds dist/dsw-quarry-pause-<version>.jar (docs/56 §3) and prints its sha512.
#
#   mods/quarry-pause/build.sh
#
# No Gradle and no Minecraft download: javac in a throwaway JDK container (memory cap, no network) against the three
# jars the code names, each pinned by sha512, plus compile-only stand-ins for the four Minecraft classes in the mixin
# signatures (stubs/; never packed). The jar's dates are fixed, so the same source gives the same sha512.
# The jar ships like docs/58's: put into data/private-jars/ on the stack, pinned by sha512 in mods.json.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
version=$(sed -n 's/^version = "\(.*\)"$/\1/p' "$here/src/main/resources/META-INF/neoforge.mods.toml")
image=eclipse-temurin:21.0.4_7-jdk-alpine
deps="$here/dist/deps"
mkdir -p "$deps"

fetch() { # name url sha512
  local f="$deps/$1"
  [ -f "$f" ] && [ "$(sha512sum "$f" | cut -d' ' -f1)" = "$3" ] && return 0
  curl -sfL -o "$f.part" "$2"
  [ "$(sha512sum "$f.part" | cut -d' ' -f1)" = "$3" ] || { rm -f "$f.part"; echo "build: $1 does not match its sha512" >&2; exit 1; }
  mv "$f.part" "$f"
}
# the quarry, as in modpack/mods.lock.json; the mixin targets were read from this exact jar
fetch quarryplus.jar https://cdn.modrinth.com/data/jhxX1zVW/versions/p0XlQYuL/AdditionalEnchantedMiner-1.21.1-neoforge-21.1.164.jar \
  "$(python3 -c "import json,sys;print([f for f in json.load(open(sys.argv[1]))['files'] if f['filename']=='AdditionalEnchantedMiner-1.21.1-neoforge-21.1.164.jar'][0]['sha512'])" "$here/../../modpack/mods.lock.json")"
# @Mod, from the FancyModLoader NeoForge 21.1.253 runs; the mixin annotations, from the Mixin it runs
fetch loader.jar https://maven.neoforged.net/releases/net/neoforged/fancymodloader/loader/4.0.45/loader-4.0.45.jar \
  "$(curl -sfL https://maven.neoforged.net/releases/net/neoforged/fancymodloader/loader/4.0.45/loader-4.0.45.jar.sha512)"
fetch mixin.jar "https://maven.fabricmc.net/net/fabricmc/sponge-mixin/0.15.2+mixin.0.8.7/sponge-mixin-0.15.2+mixin.0.8.7.jar" \
  "$(curl -sfL "https://maven.fabricmc.net/net/fabricmc/sponge-mixin/0.15.2+mixin.0.8.7/sponge-mixin-0.15.2+mixin.0.8.7.jar.sha512")"

out="dsw-quarry-pause-$version.jar"
docker run --rm --memory=512m --network=none --user "$(id -u):$(id -g)" \
  -v "$here:/src:ro" -v "$here/dist:/out" "$image" sh -euc '
    cd /tmp
    javac -proc:none --release 21 -d stubs $(find /src/stubs -name "*.java")
    javac -proc:none --release 21 -cp stubs:/out/deps/quarryplus.jar:/out/deps/loader.jar:/out/deps/mixin.jar \
      -d classes $(find /src/src/main/java -name "*.java")
    cp -r /src/src/main/resources/. classes/
    cp /src/LICENSE classes/META-INF/LICENSE
    cd classes
    set -- $(find . -type f | sort)
    jar --create --date=2026-10-12T00:00:00Z --file "/out/'"$out"'" "$@"
  '
echo "dist/$out"
sha512sum "$here/dist/$out" | cut -d' ' -f1
