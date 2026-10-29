#!/usr/bin/env bash
# Builds dist/ArPhEx-5.0.2-dsw.1-neoforge-1.21.1.jar (README.md) and prints its sha512.
#
#   mods/arphex-ashmoon/build.sh
#
# No Gradle and no Minecraft download: ArPhEx 5.0.2 as Modrinth serves it, five procedures changed by Patch.java
# with ASM, in a throwaway JDK container (memory cap, no network). Every input is pinned by sha512 and the patch
# keeps every entry's date, so the same inputs give the same sha512.
# The jar ships like docs/58's: put into data/private-jars/ on the stack, pinned by sha512 in mods.json.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# the JDK image by digest, so a re-tagged image cannot slip in (the one mods/quarry-pause/build.sh uses)
image=eclipse-temurin:21.0.4_7-jdk-alpine@sha256:37abc85b7046a2301ce60e76a28ab07a339e864fd9376c4b44b64b07c44a52d6
deps="$here/dist/deps"
mkdir -p "$deps"

fetch() { # name url sha512
  local f="$deps/$1"
  [ -f "$f" ] && [ "$(sha512sum "$f" | cut -d' ' -f1)" = "$3" ] && return 0
  curl -sfL -o "$f.part" "$2"
  [ "$(sha512sum "$f.part" | cut -d' ' -f1)" = "$3" ] || { rm -f "$f.part"; echo "build: $1 does not match its sha512" >&2; exit 1; }
  mv "$f.part" "$f"
}
# ArPhEx 5.0.2 (Modrinth k0RPP4IO, version jawvD7YZ); the patch was written against this exact jar
fetch arphex.jar https://cdn.modrinth.com/data/k0RPP4IO/versions/jawvD7YZ/ArPhEx-5.0.2-neoforge-1.21.1.jar \
  09a7e63a75ba0173ef6f60a71154a21cf6b5d07a2190d274fc9b75db23f4044ca829385b8931c698c3ed0ef48b06871c545537b2d31e1496b967e38d82922527
# ASM 9.7.1 and its tree API, sha512 as Maven Central publishes them (*.jar.sha512, read 2026-10-27 and 2026-10-29)
fetch asm.jar https://repo1.maven.org/maven2/org/ow2/asm/asm/9.7.1/asm-9.7.1.jar \
  4767b01603dad5c79cc1e2b5f3722f72b1059d928f184f446ba11badeb1b381b3a3a9a801cc43d25d396df950b09d19597c73173c411b1da890de808b94f1f50
fetch asm-tree.jar https://repo1.maven.org/maven2/org/ow2/asm/asm-tree/9.7.1/asm-tree-9.7.1.jar \
  e55008c392fdd35e95d3404766b12dd4b46e13d5c362fcd0ab42a65751a82737eaf0ebc857691d1916190d34407adfde4437615d69c278785416fd911e00978d

out="ArPhEx-5.0.2-dsw.1-neoforge-1.21.1.jar"
docker run --rm --memory=512m --network=none --user "$(id -u):$(id -g)" \
  -v "$here:/src:ro" -v "$here/dist:/out" "$image" sh -euc '
    cd /tmp
    cp=/out/deps/asm.jar:/out/deps/asm-tree.jar
    javac -proc:none --release 21 -cp $cp -d classes /src/Patch.java
    java -cp classes:$cp Patch /out/deps/arphex.jar "/out/'"$out"'"
  '
echo "dist/$out"
sha512sum "$here/dist/$out" | cut -d' ' -f1
