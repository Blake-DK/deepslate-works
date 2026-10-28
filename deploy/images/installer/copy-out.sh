#!/bin/sh
# deepslate-installer's command: put DeepslateWorks.exe, its .sha256 and VERSION into $OUT/ci (dist/ci), which
# Admin -> Build (installer) checks and hands out. Run once per redeploy by the stack's `installer` service, as uid 1000
# (dist/ belongs to it). Never fatal for the stack: a copy that fails leaves dist/ci as it was.
set -eu

OUT=${OUT:-/out}
src=

want=$(cut -d' ' -f1 "$src/DeepslateWorks.exe.sha256")
got=$(sha256sum "$src/DeepslateWorks.exe" | cut -d' ' -f1)
[ "$want" = "$got" ] || { echo "installer: the exe in this image does not match its .sha256; dist/ci left as it was" >&2; exit 0; }

if [ -f "$OUT/ci/DeepslateWorks.exe.sha256" ] && [ "$(cut -d' ' -f1 "$OUT/ci/DeepslateWorks.exe.sha256")" = "$want" ]; then
  echo "installer: dist/ci already has DeepslateWorks.exe $(cat "$src/VERSION")"
  exit 0
fi

rm -rf "$OUT/ci.new"
mkdir -p "$OUT/ci.new"
cp "$src/DeepslateWorks.exe" "$src/DeepslateWorks.exe.sha256" "$src/VERSION" "$OUT/ci.new/"
rm -rf "$OUT/ci"
mv "$OUT/ci.new" "$OUT/ci"
echo "installer: DeepslateWorks.exe $(cat "$OUT/ci/VERSION") in dist/ci (run Build -> installer to publish it)"
