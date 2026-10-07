import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Fix 2 (2026-10-07): deploy.sh runs the version it just pulled, once (deploy/rerun.sh). A stand-in deploy script
// sources the real rerun.sh and ops-lock.sh, takes the lock, "pulls", and writes each step to a log.
const deployDir = fileURLToPath(new URL("../../../deploy/", import.meta.url));

function setup(changed: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "rerun-"));
  const log = path.join(dir, "log");
  const script = path.join(dir, "deploy.sh");
  writeFileSync(log, "");
  writeFileSync(script, `
set -e
. "${deployDir}ops-lock.sh"
. "${deployDir}rerun.sh"
git_here() { printf '%s' "$CHANGED"; }
check_git_guards() { echo guards >> "$LOG"; [ -z "$GUARDS_FAIL" ] || { echo "deploy: .git/config is not the copy" >&2; exit 1; }; }
ops_lock deploy || exit 75
echo "run rerun=\${DEEPSLATE_DEPLOY_RERUN:-no}" >> "$LOG"
# while the second run holds the lock, nobody else can take it
if [ -n "\${DEEPSLATE_DEPLOY_RERUN:-}" ]; then ( exec 8>>"$OPS_LOCK"; flock -n 8 && echo "lock was free" >> "$LOG" || echo "lock held" >> "$LOG" ); fi
deploy_rerun_if_changed aaaaaaa bbbbbbb
echo done >> "$LOG"
`);
  const run = (env: Record<string, string> = {}) =>
    spawnSync("sh", [script], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH, LOG: log, CHANGED: changed, GUARDS_FAIL: "", DEEPSLATE_CALLER: "test",
        OPS_LOCK: path.join(dir, "ops.lock"), OPS_HOLDER: path.join(dir, "ops.holder"),
        DEPLOY_SHELL: "sh", DEPLOY_SCRIPT: script, ...env,
      },
    });
  return { run, log: () => readFileSync(log, "utf8").trim().split("\n") };
}

describe("deploy.sh runs the version it just pulled", () => {
  it("a pull that changed deploy.sh: the guards run, then the new script runs once and only once, holding the lock", () => {
    const t = setup("deploy/deploy.sh\n");
    const r = t.run();
    expect(r.status).toBe(0);
    expect(t.log()).toEqual(["run rerun=no", "guards", "run rerun=1", "lock held", "done"]);
    expect(r.stdout.match(/the new deploy\.sh runs now/g)).toHaveLength(1);
    expect(r.stdout).toContain("deploy: the pull changed deploy/deploy.sh so the new deploy.sh runs now");
    expect(r.stdout).toContain("this is already the pulled deploy.sh; not running it again");
  });

  it("a pull that changed only git-guard.sh runs the new script too", () => {
    const t = setup("deploy/git-guard.sh\n");
    expect(t.run().status).toBe(0);
    expect(t.log()).toEqual(["run rerun=no", "guards", "run rerun=1", "lock held", "done"]);
  });

  it("a pull that did not change them goes on with the script it has", () => {
    const t = setup("");
    const r = t.run();
    expect(r.status).toBe(0);
    expect(t.log()).toEqual(["run rerun=no", "done"]);
    expect(r.stdout).toBe("");
  });

  it("when the .git checks fail after the pull, nothing from the pulled tree runs", () => {
    const t = setup("deploy/deploy.sh\n");
    const r = t.run({ GUARDS_FAIL: "1" });
    expect(r.status).toBe(1);
    expect(t.log()).toEqual(["run rerun=no", "guards"]);
    expect(r.stdout).not.toContain("runs now");
  });

  it("deploy.sh calls it after the pull, and the .git checks are one function run before the pull", () => {
    const sh = readFileSync(path.join(deployDir, "deploy.sh"), "utf8");
    const pull = sh.indexOf("git_here pull --ff-only");
    expect(sh.indexOf("\ncheck_git_guards\n")).toBeGreaterThan(0);
    expect(sh.indexOf("\ncheck_git_guards\n")).toBeLessThan(sh.indexOf("git_here fetch -q origin main"));
    expect(sh.indexOf('deploy_rerun_if_changed "$before_pull" "$head_sha"')).toBeGreaterThan(pull);
    expect(sh.indexOf("before_pull=$(git_here rev-parse HEAD)")).toBeLessThan(pull);
  });
});
