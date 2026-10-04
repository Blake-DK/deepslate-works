import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Env } from "../env.js";
import { sshCommand } from "../modpack/ssh.js";

// docs/28 §2 point 5 and §4.3 step 3, brought forward by docs/31 B-07: until this ran, no database dump had ever
// left the VPS (docs/33 §6). The newest nightly dump is copied into `_backup/db/` in the instance over the rsync
// link the pack already uses. From there it is inside AMP's next world backup, and the AMP host's own script
// copies it on to the share (docs/28 §3 F). Nothing is deleted here or there by this.
//
// The `backups` container cannot do it itself: it is not in the tunnel's namespace and has neither the key nor
// rsync. The deploy key is rooted at the instance's Minecraft/ folder, so `_backup/db/` is as far as it reaches.

const DUMP_RE = /^deepslate-\d{4}-\d{2}-\d{2}\.sql\.gz$/;

/** The newest nightly dump by its date in the name; `pre-*` dumps and half-written `.part` files never count. */
export function newestDump(names: readonly string[]): string | null {
  const dumps = names.filter((n) => DUMP_RE.test(n)).sort();
  return dumps.length > 0 ? dumps[dumps.length - 1]! : null;
}

type Run = (cmd: string, args: string[], timeoutMs: number) => Promise<{ code: number; out: string }>;

const run: Run = (cmd, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? ((err as { code?: number }).code ?? 1) : 0;
      resolve({ code: typeof code === "number" ? code : 1, out: `${stdout}${stderr}` });
    });
  });

export class DumpPush {
  /** The dump last copied, and when; what /health can show later. Forgotten at a restart: the copy is then made again, which changes nothing. */
  last: { name: string; at: Date } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private env: Pick<Env, "DEPLOY_KEY_PATH" | "RSYNC_TARGET">,
    private log: (o: unknown, m: string) => void,
    private dir: string = process.env.DB_DUMPS_DIR ?? "/dbdumps",
    private exec: Run = run,
    private list: (dir: string) => Promise<string[]> = (d) => readdir(d),
  ) {}

  start() {
    this.timer = setInterval(() => void this.round(), 10 * 60_000); // the dump is made at 00:00 UTC, AMP's backup runs at 01:00
    setTimeout(() => void this.round(), 2 * 60_000).unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Copies the newest dump unless it is the one already copied. "none": no dump folder or no dump in it. */
  async round(): Promise<"copied" | "same" | "none" | "failed"> {
    if (this.busy) return "same";
    this.busy = true;
    try {
      let names: string[];
      try {
        names = await this.list(this.dir);
      } catch {
        return "none"; // the folder is not mounted (a development machine, or a host before this change)
      }
      const name = newestDump(names);
      if (!name) return "none";
      if (this.last?.name === name) return "same";
      const target = this.env.RSYNC_TARGET.endsWith(":") ? this.env.RSYNC_TARGET : `${this.env.RSYNC_TARGET}:`;
      // `_backup/` is there already (the host's status file lives in it); rsync makes `db/` itself, the last folder of the path
      const ssh = sshCommand(this.env.DEPLOY_KEY_PATH, 10);
      const r = await this.exec("rsync", ["-t", "--partial", "-e", ssh, path.join(this.dir, name), `${target}_backup/db/`], 600_000);
      if (r.code !== 0) {
        this.log({ name, code: r.code, out: r.out.trim().split("\n").slice(-3) }, "database dump NOT copied to the AMP host");
        return "failed";
      }
      this.last = { name, at: new Date() };
      this.log({ name }, "database dump copied to the AMP host (_backup/db/)");
      return "copied";
    } finally {
      this.busy = false;
    }
  }
}
