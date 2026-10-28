#!/usr/bin/env bash
# Builds dist/fairylights-neoforge-1.21.1-1.2.3-dsw.1.jar (README.md) and prints its sha512.
#
#   mods/fairylights-jei-fix/build.sh
#
# No Gradle and no Minecraft download: Fairy Lights 1.2.3 as Modrinth serves it, one method changed by Patch.java
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
# Fairy Lights 1.2.3 (Modrinth OuLVx5LM, version LQ4yv2U3); the patch was written against this exact jar
fetch fairylights.jar https://cdn.modrinth.com/data/OuLVx5LM/versions/LQ4yv2U3/fairylights-neoforge-1.21.1-1.2.3.jar \
  53d293170595cb45c0742aa6388a790799e760c88e704b55fcc3d729153d923aff0963675a35b670b22b5a2028424cce7aedbaa2531a22bda62bcae81444871e
# ASM 9.7.1, sha512 as Maven Central publishes it (asm-9.7.1.jar.sha512, read 2026-10-27)
fetch asm.jar https://repo1.maven.org/maven2/org/ow2/asm/asm/9.7.1/asm-9.7.1.jar \
  4767b01603dad5c79cc1e2b5f3722f72b1059d928f184f446ba11badeb1b381b3a3a9a801cc43d25d396df950b09d19597c73173c411b1da890de808b94f1f50

out="fairylights-neoforge-1.21.1-1.2.3-dsw.1.jar"
docker run --rm --memory=512m --network=none --user "$(id -u):$(id -g)" \
  -v "$here:/src:ro" -v "$here/dist:/out" "$image" sh -euc '
    cd /tmp
    javac -proc:none --release 21 -cp /out/deps/asm.jar -d classes /src/Patch.java
    java -cp classes:/out/deps/asm.jar Patch /out/deps/fairylights.jar "/out/'"$out"'"
  '
echo "dist/$out"
sha512sum "$here/dist/$out" | cut -d' ' -f1
