# Sourced by deploy/deploy.sh. `web` can write this checkout's .git (Admin -> Lock commits there), so it could leave a
# hook in .git/hooks. deploy.sh's own git runs no hooks (git_here), but every other git command on this host does, as
# the checkout's owner: a hook that is not the one Alex read would run as him at the next commit or push. The hooks
# that may be there are listed, with their sha256, in a file under /root that web cannot reach; anything else in
# .git/hooks, or a hook whose bytes changed, stops the deploy. Plain sh and busybox, so the tests run it as it is.

# One line per entry in <hooks dir> that is not a .sample: "<sha256>  <name>" for a regular file, "<kind>  <name>"
# for anything else (a link, a folder), sorted by name.
git_hooks_listing() {
  ( cd "$1" || exit 1
    for f in * .[!.]* ..?*; do
      [ -e "$f" ] || [ -L "$f" ] || continue
      case "$f" in *.sample) continue ;; esac
      if [ -L "$f" ]; then echo "symlink  $f"
      elif [ -f "$f" ]; then sha256sum "$f"
      elif [ -d "$f" ]; then echo "folder  $f"
      else echo "other  $f"
      fi
    done ) | sort -k2
}

# Nothing on stdout when <hooks dir> holds exactly what <expected file> lists; otherwise the difference
# ("<" expected and missing or changed, ">" there and not expected). Exit 2 when the expected file is missing.
git_hooks_problems() {
  [ -s "$2" ] || return 2
  now="${TMPDIR:-/tmp}/git-hooks.now.$$"
  want="${TMPDIR:-/tmp}/git-hooks.expected.$$"
  git_hooks_listing "$1" | sed '/^$/d' | LC_ALL=C sort > "$now" || { rm -f "$now"; echo "> cannot read $1"; return 0; }
  sed '/^$/d' "$2" | LC_ALL=C sort > "$want"
  # comm, not diff: busybox's diff only writes the unified form
  LC_ALL=C comm -23 "$want" "$now" | sort -k2 | sed 's/^/< /'
  LC_ALL=C comm -13 "$want" "$now" | sort -k2 | sed 's/^/> /'
  rm -f "$now" "$want"
}
