import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Env } from "../env.js";
import { AMP_STATE, type Amp } from "../amp/client.js";
import { sshCommand } from "./ssh.js";
import { jarChangeLines, jarChanges } from "./jar-changes.js";

// docs/06 + docs/13 §4: rsync dist/server/ into the AMP instance's Minecraft/ dir over the tunnel
// (rrsync-restricted deploy key), then Core.Restart through the ADS proxy if the mod set changed. Whether the server
// came back with every mod is checked after it (modpack/verify.ts, POST /modpack/verify).

const DIST_SERVER = process.env.DIST_SERVER_DIR ?? "/repo/dist/server";
const LEVEL_NAME = /^[A-Za-z0-9_-]{1,40}$/.test(process.env.LEVEL_NAME ?? "") ? (process.env.LEVEL_NAME as string) : "world";

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? ((err as { code?: number }).code ?? 1) : 0;
      resolve({ code: typeof code === "number" ? code : 1, out: `${stdout}${stderr}` });
    });
  });
}

/**
 * What a Sync does to the server once the files are there (Alex, 2026-10-20: "the sync script should start the server
 * too"). Running (20): restarted when the mods changed. Asleep (45, 50): started, which wakes it, when the mods changed,
 * and on the test server always. Stopped (0): started on the test server only; live is only ever stopped on purpose
 * (the maintenance window of 2026-10-09), and a Sync then must not bring it up. Starting, stopping, failed or not known:
 * left alone. AMP's Core.Start wakes a sleeping server as well as starting a stopped one (status/wake.ts).
 */
export type AfterSync = "restart" | "start" | "leave";
export function afterSync(stateCode: number | null | undefined, modsChanged: boolean, testMode: boolean): AfterSync {
  if (stateCode === 20) return modsChanged ? "restart" : "leave";
  if (stateCode === 45 || stateCode === 50) return modsChanged || testMode ? "start" : "leave";
  if (stateCode === 0) return testMode ? "start" : "leave";
  return "leave";
}

export type SyncResult = { ok: boolean; lines: string[]; restarted: boolean; dryRun: boolean; modsChanged?: boolean; /** When Core.Restart was sent: the check waits for a start after it. */ restartedAt?: string };

export async function syncServer(env: Env, amp: Amp, opts: { dryRun?: boolean; beforeRestart?: () => Promise<unknown> } = {}): Promise<SyncResult> {
  const dryRun = Boolean(opts.dryRun);
  const lines: string[] = [];
  try {
    const s = await stat(path.join(DIST_SERVER, "mods"));
    if (!s.isDirectory()) throw new Error("no mods dir");
  } catch {
    return { ok: false, lines: ["dist/server/mods not found: run Build first"], restarted: false, dryRun };
  }
  const ssh = sshCommand(env.DEPLOY_KEY_PATH, 10);
  const target = env.RSYNC_TARGET.endsWith(":") ? env.RSYNC_TARGET : `${env.RSYNC_TARGET}:`;
  // 1. mods: replaced wholesale (--delete), dry run first to learn whether anything changes
  const dry = await run("rsync", ["-rlt", "--delete", "--itemize-changes", "--dry-run", "-e", ssh, `${DIST_SERVER}/mods/`, `${target}mods/`], 120_000);
  if (dry.code !== 0) return { ok: false, lines: [...lines, `rsync dry-run failed (${dry.code}):`, ...dry.out.trim().split("\n").slice(-8)], restarted: false, dryRun };
  const changes = dry.out.split("\n").filter((l) => /^[<>ch*.]/.test(l) && !/^\.d/.test(l) && l.trim() !== "");
  const modsChanged = changes.length > 0;
  // what the dry run found, which is also what decides the restart; a new version of a mod reads as "updated", not as
  // one jar removed and another added
  lines.push(...jarChangeLines(jarChanges(changes)));
  if (dryRun) {
    lines.push(modsChanged ? "dry run: nothing written; a real sync would restart the server" : "dry run: nothing to do");
    return { ok: true, lines, restarted: false, dryRun };
  }
  const real = await run("rsync", ["-rlt", "--delete", "--itemize-changes", "-e", ssh, `${DIST_SERVER}/mods/`, `${target}mods/`], 900_000);
  if (real.code !== 0) return { ok: false, lines: [...lines, `rsync mods failed (${real.code}):`, ...real.out.trim().split("\n").slice(-8)], restarted: false, dryRun };
  // 2. configs and server-only files: merged, never deleted. --checksum: Build writes every file anew, so by size and
  //    time all of them looked changed at every Sync ("179 file(s) updated" with nothing new); now only content counts.
  for (const dir of ["config", "bluemap", "defaultconfigs"]) {
    try {
      await readdir(path.join(DIST_SERVER, dir));
    } catch {
      continue;
    }
    const r = await run("rsync", ["-rlt", "--checksum", "--itemize-changes", "-e", ssh, `${DIST_SERVER}/${dir}/`, `${target}${dir}/`], 300_000);
    if (r.code !== 0) return { ok: false, lines: [...lines, `rsync ${dir} failed (${r.code}):`, ...r.out.trim().split("\n").slice(-5)], restarted: false, dryRun };
    const n = r.out.split("\n").filter((l) => /^[<>ch*]/.test(l)).length;
    lines.push(`${dir}: ${n} file(s) updated`);
  }
  // 2a. the server-list icon (the chosen logo, 64×64) in the server's own folder; read at start
  try {
    await stat(path.join(DIST_SERVER, "server-icon.png"));
    const r = await run("rsync", ["-t", "--checksum", "--itemize-changes", "-e", ssh, `${DIST_SERVER}/server-icon.png`, `${target}server-icon.png`], 120_000);
    if (r.code !== 0) return { ok: false, lines: [...lines, `rsync server-icon.png failed (${r.code}):`, ...r.out.trim().split("\n").slice(-5)], restarted: false, dryRun };
    lines.push(r.out.split("\n").some((l) => /^[<>ch*]/.test(l)) ? "server-icon.png: updated; the server list shows it after the next start" : "server-icon.png: up to date");
  } catch {
    /* no logo chosen */
  }
  // 2b. datapacks go into the world. A new dimension is only there after a restart; that restart is not made here,
  //     it is for an admin to choose the moment.
  try {
    await readdir(path.join(DIST_SERVER, "datapacks"));
    const r = await run("rsync", ["-rlt", "--checksum", "--itemize-changes", "-e", ssh, `${DIST_SERVER}/datapacks/`, `${target}${LEVEL_NAME}/datapacks/`], 300_000);
    if (r.code !== 0) return { ok: false, lines: [...lines, `rsync datapacks failed (${r.code}):`, ...r.out.trim().split("\n").slice(-5)], restarted: false, dryRun };
    const n = r.out.split("\n").filter((l) => /^[<>ch*]/.test(l) && !/^cd/.test(l)).length;
    lines.push(n ? `datapacks: ${n} file(s) updated in ${LEVEL_NAME}/datapacks; restart the server for them to count` : "datapacks: up to date");
  } catch {
    /* none built */
  }
  // 3. restart, start or leave the server (afterSync above): a running one is restarted when the mods changed, a sleeping
  //    one is woken to load them, and the test server is always left running; live, stopped on purpose, stays stopped
  const testMode = env.TEST_MODE === "1";
  const code = env.AMP_MOCK === "1" ? 20 : await amp.getStatus().then((s) => s.stateCode ?? null).catch(() => null);
  const next = afterSync(code, modsChanged, testMode);
  if (next === "leave") {
    if (code === 20) lines.push("mods unchanged: the server keeps running, no restart");
    else if (code === 45 || code === 50) lines.push("mods unchanged and the server is asleep: it stays asleep");
    else if (code === 0) lines.push(`the server is stopped: not started, as live is only ever stopped on purpose; ${modsChanged ? "it loads the new mods at its next start" : "the mods are up to date"} (Admin → Server → Start)`);
    else lines.push(`the server is ${AMP_STATE[code ?? -1] ?? "in an unknown state"} (AMP state ${code ?? "unknown"}): not restarted or started; every start is checked for missing mods`);
    return { ok: true, lines, restarted: false, dryRun, modsChanged };
  }
  if (env.AMP_MOCK === "1") {
    lines.push(`AMP_MOCK=1: would ${next} the server`);
    return { ok: true, lines, restarted: true, dryRun, modsChanged };
  }
  const restartedAt = new Date().toISOString();
  if (next === "restart") {
    await opts.beforeRestart?.().catch(() => undefined); // a running pre-generation is paused and saved first
    await amp.call("Core", "Restart");
    lines.push("restarting the server to load the new mods…");
  } else {
    await amp.call("Core", "Start");
    lines.push(modsChanged ? `starting the server (it was ${code === 0 ? "stopped" : "asleep"}) to load the new mods…` : `starting the test server (it was ${code === 0 ? "stopped" : "asleep"}), so it runs the pack as it is…`);
  }
  return { ok: true, lines, restarted: true, dryRun, modsChanged, restartedAt };
}
