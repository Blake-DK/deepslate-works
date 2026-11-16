import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// deploy/hooks/pre-push, run as git runs it: "<remote> <url>" as arguments, one line per pushed ref on stdin, inside
// a small repository made for each test. The repository is public, so a push that adds an address outside the
// placeholder ranges is refused.

const hook = fileURLToPath(new URL("../../../deploy/hooks/pre-push", import.meta.url));
const ZERO = "0".repeat(40);
const REMOTE = "https://example.invalid/repo.git";

// Addresses are put together here, so this file holds none and passes the hook it tests. All of them are made up.
const ip = (...parts: number[]) => parts.join(".");
const LAN = ip(10, 20, 30, 40);
const HOME = ip(192, 168, 7, 9);
const SUBNET = `${ip(172, 20, 0, 0)}/16`;
const PUBLIC = ip(93, 184, 10, 20);

const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
// deploy/check.sh runs the tests in an image without git: there this file is skipped, and CI runs it.
const hasGit = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "push-"));
  const git = (...a: string[]) => {
    const r = spawnSync("git", a, { cwd: dir, env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git("init", "-q", "-b", "work");
  git("remote", "add", "origin", REMOTE);
  // A folder of its own, not .git/hooks: the hook finds its neighbour by its own path, and nothing here runs it unasked.
  const hooks = path.join(dir, "hooks");
  mkdirSync(hooks);
  copyFileSync(hook, path.join(hooks, "pre-push"));
  const local = (text: string | null) => (text === null ? rmSync(path.join(hooks, "pre-push-local"), { force: true }) : writeFileSync(path.join(hooks, "pre-push-local"), text));
  local("#!/bin/sh\nexit 0\n");
  const commit = (files: Record<string, string>) => {
    for (const [f, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      writeFileSync(path.join(dir, f), text);
    }
    git("add", "-A");
    git("commit", "-q", "-m", "c");
    return git("rev-parse", "HEAD");
  };
  /** The remote has this commit already, on the branch named. */
  const onRemote = (sha: string, branch = "main") => git("update-ref", `refs/remotes/origin/${branch}`, sha);
  const push = (sha: string, o: { env?: Record<string, string>; remoteSha?: string } = {}) =>
    spawnSync("sh", [path.join(hooks, "pre-push"), "origin", REMOTE], { cwd: dir, env: { ...env, ...o.env }, input: `refs/heads/work ${sha} refs/heads/work ${o.remoteSha ?? ZERO}\n`, encoding: "utf8" });
  const base = commit({ "README.md": "hello\n" });
  onRemote(base);
  return { git, commit, onRemote, push, local, base };
}

describe.skipIf(!hasGit)("the pre-push hook refuses a push that adds a real address", () => {
  it("a LAN address in a URL: refused, with the commit, the file and the address", () => {
    const t = repo();
    const sha = t.commit({ "deploy/example.env": `AMP_URL=http://${LAN}:8080\n` });
    const r = t.push(sha);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`${sha.slice(0, 7)} deploy/example.env: ${LAN}`);
    expect(r.stderr).toContain("push refused, nothing was sent");
  });

  it("every way an address is written: a subnet, a console line, an rsync target, the end of a sentence", () => {
    const t = repo();
    const sha = t.commit({ "docs/a.md": `the tunnel is ${SUBNET}\nBramble09[/${PUBLIC}:51234] logged in\namp@${HOME}:\nIt answers on ${LAN}.\n` });
    const r = t.push(sha);
    expect(r.status).toBe(1);
    for (const a of [ip(172, 20, 0, 0), PUBLIC, HOME, LAN]) expect(r.stderr).toContain(`docs/a.md: ${a}`);
  });

  it("the placeholder ranges, loopback and 0.0.0.0 pass", () => {
    const t = repo();
    const sha = t.commit({ "docs/a.md": "203.0.113.2 and 198.51.100.8:8080, 203.0.113.0/24, http://127.0.0.1:3000, 127.8.9.10, 0.0.0.0\n" });
    const r = t.push(sha);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("version numbers that are part of something longer, or have a part over 255, are not addresses", () => {
    const t = repo();
    const sha = t.commit({ "docs/a.md": "mekanism 1.21.1-10.7.19.85, Java 21.0.12.1+1-LTS, owo 0.12.15.5-beta.1, 1.2.3.4.5, JEI 19.64.0.455, v2.8.0.8\n" });
    expect(t.push(sha).status).toBe(0);
  });

  it("a bare version of four small numbers reads like an address: refused, and PUSH_ADDRESSES_OK=1 lets it through", () => {
    const t = repo();
    const version = ip(10, 7, 19, 85);
    const sha = t.commit({ "docs/a.md": `Mekanism ${version}\n` });
    expect(t.push(sha).status).toBe(1);
    const r = t.push(sha, { env: { PUSH_ADDRESSES_OK: "1" } });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(`docs/a.md: ${version}`);
  });

  it("generated lock files are not read", () => {
    const t = repo();
    const sha = t.commit({ "modpack/mods.lock.json": `{ "versionNumber": "${ip(19, 0, 0, 1)}" }\n`, "pnpm-lock.yaml": `x@${ip(19, 0, 0, 1)}:\n` });
    expect(t.push(sha).status).toBe(0);
  });

  it("what the remote already has is not read again, and taking an address out passes", () => {
    const t = repo();
    const old = t.commit({ "docs/old.md": `AMP is at ${LAN}\n` });
    t.onRemote(old);
    expect(t.push(t.commit({ "docs/new.md": "nothing to see\n" }), { remoteSha: old }).status).toBe(0);
    expect(t.push(t.commit({ "docs/old.md": "AMP is at 198.51.100.8\n" }), { remoteSha: old }).status).toBe(0);
  });

  it("an address added in one commit and removed in the next is still sent: refused", () => {
    const t = repo();
    const added = t.commit({ "docs/a.md": `AMP is at ${LAN}\n` });
    const removed = t.commit({ "docs/a.md": "AMP is at 198.51.100.8\n" });
    const r = t.push(removed);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`${added.slice(0, 7)} docs/a.md: ${LAN}`);
  });

  it("a merge that brings an address in from another branch of the remote is refused", () => {
    const t = repo();
    t.git("checkout", "-q", "-b", "other");
    const theirs = t.commit({ "docs/theirs.md": `AMP is at ${LAN}\n` });
    t.onRemote(theirs, "other");
    t.git("checkout", "-q", "work");
    t.commit({ "docs/mine.md": "mine\n" });
    t.git("merge", "-q", "--no-ff", "-m", "merge", "other");
    const r = t.push(t.git("rev-parse", "HEAD"));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`docs/theirs.md: ${LAN}`);
  });

  it("a deleted branch sends nothing", () => {
    const t = repo();
    t.commit({ "docs/a.md": `AMP is at ${LAN}\n` });
    expect(t.push(ZERO).status).toBe(0);
  });

  it("the checkout's own checks run first: their refusal refuses the push, with the lines git gave", () => {
    const t = repo();
    const sha = t.commit({ "docs/a.md": "fine\n" });
    t.local('#!/bin/sh\nread -r ref sha rest\necho "local: $1 $ref $sha" >&2\nexit 1\n');
    const r = t.push(sha);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`local: origin refs/heads/work ${sha}`);
  });

  it("without the checkout's own checks the push is refused, unless it says it has none", () => {
    const t = repo();
    const sha = t.commit({ "docs/a.md": "fine\n" });
    t.local(null);
    const r = t.push(sha);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("pre-push-local is missing");
    expect(t.push(sha, { env: { PRE_PUSH_NO_LOCAL: "1" } }).status).toBe(0);
  });
});
