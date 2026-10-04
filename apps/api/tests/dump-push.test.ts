import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DumpPush, newestDump } from "../src/backup/dump-push.js";
import { isDbDumps } from "../src/files/browse.js";
import { sshCommand } from "../src/modpack/ssh.js";

const env = { DEPLOY_KEY_PATH: "/run/keys/deploy.key", RSYNC_TARGET: "amp@10.77.0.2:" };

describe("the newest database dump goes to the AMP host (docs/31 B-07)", () => {
  it("newest by the date in the name; pre-* dumps and .part files never count", () => {
    expect(newestDump(["deepslate-2026-10-03.sql.gz", "deepslate-2026-10-04.sql.gz", "pre-0024-x.sql.gz", "deepslate-2026-10-05.sql.gz.part", "deepslate-%F.sql.gz"])).toBe("deepslate-2026-10-04.sql.gz");
    expect(newestDump(["pre-0024-x.sql.gz"])).toBeNull();
    expect(newestDump([])).toBeNull();
  });

  it("copies the newest once into _backup/db/, and again only when a newer one is there", async () => {
    const calls: string[][] = [];
    let names = ["deepslate-2026-10-03.sql.gz", "deepslate-2026-10-04.sql.gz"];
    const push = new DumpPush(env, () => undefined, "/dbdumps", async (_cmd, args) => { calls.push(args); return { code: 0, out: "" }; }, async () => names);
    expect(await push.round()).toBe("copied");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.slice(-2)).toEqual(["/dbdumps/deepslate-2026-10-04.sql.gz", "amp@10.77.0.2:_backup/db/"]);
    expect(calls[0]!).not.toContain("--delete");
    expect(await push.round()).toBe("same");
    expect(calls).toHaveLength(1);
    names = [...names, "deepslate-2026-10-05.sql.gz"];
    expect(await push.round()).toBe("copied");
    expect(push.last?.name).toBe("deepslate-2026-10-05.sql.gz");
  });

  it("a failed copy is tried again at the next round and says so in the log", async () => {
    const said: string[] = [];
    let code = 255;
    const push = new DumpPush(env, (_o, m) => said.push(m), "/dbdumps", async () => ({ code, out: "ssh: connect to host 10.77.0.2 port 22: timed out" }), async () => ["deepslate-2026-10-04.sql.gz"]);
    expect(await push.round()).toBe("failed");
    expect(push.last).toBeNull();
    expect(said[0]).toMatch(/NOT copied/);
    code = 0;
    expect(await push.round()).toBe("copied");
  });

  it("no dump folder, or none in it: nothing is run", async () => {
    let ran = 0;
    const missing = new DumpPush(env, () => undefined, "/nowhere", async () => { ran++; return { code: 0, out: "" }; }, async () => { throw new Error("ENOENT"); });
    expect(await missing.round()).toBe("none");
    const empty = new DumpPush(env, () => undefined, "/dbdumps", async () => { ran++; return { code: 0, out: "" }; }, async () => []);
    expect(await empty.round()).toBe("none");
    expect(ran).toBe(0);
  });

  it("the file browser refuses _backup/db whatever the saved denied list says", () => {
    for (const p of ["_backup/db", "_backup/db/deepslate-2026-10-04.sql.gz", "_BACKUP/DB/x", "/_backup/db/"]) expect([p, isDbDumps(p)]).toEqual([p, true]);
    for (const p of ["_backup", "_backup/status.json", "_backup/dbx", "config/_backup/db"]) expect([p, isDbDumps(p)]).toEqual([p, false]);
  });
});

describe("the AMP host's key is pinned when a known_hosts file is there (docs/31 B-23)", () => {
  it("strict with the file, as before without it", () => {
    expect(sshCommand("/k", 10, "/run/keys/known_hosts", true)).toBe("ssh -i /k -o IdentitiesOnly=yes -o BatchMode=yes -o UserKnownHostsFile=/run/keys/known_hosts -o StrictHostKeyChecking=yes -o ConnectTimeout=10");
    expect(sshCommand("/k", 3, "/run/keys/known_hosts", false)).toBe("ssh -i /k -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=3");
  });
});

// deploy/backup-loop.sh with a pg_dump of our own on the PATH (docs/31 B-20)
describe("the nightly dump script", () => {
  const script = fileURLToPath(new URL("../../../deploy/backup-loop.sh", import.meta.url));
  function setup(pgDump: string) {
    const dir = mkdtempSync(path.join(tmpdir(), "dumps-"));
    mkdirSync(path.join(dir, "bin"));
    mkdirSync(path.join(dir, "out"));
    writeFileSync(path.join(dir, "bin/pg_dump"), `#!/bin/sh\n${pgDump}\n`);
    chmodSync(path.join(dir, "bin/pg_dump"), 0o755);
    for (const d of ["2026-09-01", "2026-09-02", "2026-09-03"]) writeFileSync(path.join(dir, "out", `deepslate-${d}.sql.gz`), "old");
    writeFileSync(path.join(dir, "out/pre-0024-x.sql.gz"), "pre");
    const run = () => spawnSync("sh", [script], { env: { ...process.env, PATH: `${path.join(dir, "bin")}:${process.env.PATH}`, ONCE: "1", KEEP: "2", BACKUP_DIR: path.join(dir, "out") }, encoding: "utf8" });
    return { out: path.join(dir, "out"), run };
  }

  it("a good dump is kept under today's date, the newest KEEP stay, pre-* dumps are never touched", () => {
    const t = setup('echo "CREATE TABLE x;"');
    const r = t.run();
    expect(r.status).toBe(0);
    const files = readdirSync(t.out);
    const made = files.filter((f) => f !== "deepslate-2026-09-03.sql.gz" && f !== "pre-0024-x.sql.gz");
    expect(files).toHaveLength(3); // KEEP=2: the newest old one and the new one, plus the pre- dump
    expect(made).toHaveLength(1);
    expect(made[0]).toMatch(/^deepslate-\d{4}-\d{2}-\d{2}\.sql\.gz$/);
    expect(execFileSync("gzip", ["-dc", path.join(t.out, made[0]!)], { encoding: "utf8" })).toBe("CREATE TABLE x;\n");
  });

  it("a failed dump is not kept, removes nothing, and the script says it failed", () => {
    const t = setup("echo half; exit 3");
    const r = t.run();
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/pg_dump FAILED \(exit 3\)/);
    expect(readdirSync(t.out).sort()).toEqual(["deepslate-2026-09-01.sql.gz", "deepslate-2026-09-02.sql.gz", "deepslate-2026-09-03.sql.gz", "pre-0024-x.sql.gz"]);
  });
});
