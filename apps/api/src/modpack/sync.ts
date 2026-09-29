import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Env } from "../env.js";
import type { Amp } from "../amp/client.js";

// docs/06 + docs/13 §4: rsync dist/server/ into the AMP instance's Minecraft/ dir over the tunnel
// (rrsync-restricted deploy key), then Core.Restart through the ADS proxy if the mod set changed.

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

export async function syncServer(env: Env, amp: Amp, opts: { dryRun?: boolean; beforeRestart?: () => Promise<unknown> } = {}): Promise<{ ok: boolean; lines: string[]; restarted: boolean; dryRun: boolean }> {
  const dryRun = Boolean(opts.dryRun);
  const lines: string[] = [];
  try {
    const s = await stat(path.join(DIST_SERVER, "mods"));
    if (!s.isDirectory()) throw new Error("no mods dir");
  } catch {
    return { ok: false, lines: ["dist/server/mods not found: run Build first"], restarted: false, dryRun };
  }
  const ssh = `ssh -i ${env.DEPLOY_KEY_PATH} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10`;
  const target = env.RSYNC_TARGET.endsWith(":") ? env.RSYNC_TARGET : `${env.RSYNC_TARGET}:`;
  // 1. mods: replaced wholesale (--delete), dry run first to learn whether anything changes
  const dry = await run("rsync", ["-rlt", "--delete", "--itemize-changes", "--dry-run", "-e", ssh, `${DIST_SERVER}/mods/`, `${target}mods/`], 120_000);
  if (dry.code !== 0) return { ok: false, lines: [...lines, `rsync dry-run failed (${dry.code}):`, ...dry.out.trim().split("\n").slice(-8)], restarted: false, dryRun };
  const changes = dry.out.split("\n").filter((l) => /^[<>ch*.]/.test(l) && !/^\.d/.test(l) && l.trim() !== "");
  const modsChanged = changes.length > 0;
  lines.push(modsChanged ? `mods: ${changes.length} change(s)` : "mods: up to date");
  if (dryRun) {
    for (const l of changes.slice(0, 60)) lines.push(`  ${l}`);
    lines.push(modsChanged ? "dry run: nothing written; a real sync would restart the server" : "dry run: nothing to do");
    return { ok: true, lines, restarted: false, dryRun };
  }
  const real = await run("rsync", ["-rlt", "--delete", "--itemize-changes", "-e", ssh, `${DIST_SERVER}/mods/`, `${target}mods/`], 900_000);
  if (real.code !== 0) return { ok: false, lines: [...lines, `rsync mods failed (${real.code}):`, ...real.out.trim().split("\n").slice(-8)], restarted: false, dryRun };
  for (const l of real.out.split("\n").filter((l) => /^[<>ch*]/.test(l)).slice(0, 60)) lines.push(`  ${l}`);
  // 2. configs and server-only files: merged, never deleted
  for (const dir of ["config", "bluemap", "defaultconfigs"]) {
    try {
      await readdir(path.join(DIST_SERVER, dir));
    } catch {
      continue;
    }
    const r = await run("rsync", ["-rlt", "--itemize-changes", "-e", ssh, `${DIST_SERVER}/${dir}/`, `${target}${dir}/`], 300_000);
    if (r.code !== 0) return { ok: false, lines: [...lines, `rsync ${dir} failed (${r.code}):`, ...r.out.trim().split("\n").slice(-5)], restarted: false, dryRun };
    const n = r.out.split("\n").filter((l) => /^[<>ch*]/.test(l)).length;
    lines.push(`${dir}: ${n} file(s) updated`);
  }
  // 2b. datapacks go into the world. A new dimension is only there after a restart; that restart is not made here,
  //     it is for an admin to choose the moment.
  try {
    await readdir(path.join(DIST_SERVER, "datapacks"));
    const r = await run("rsync", ["-rlt", "--itemize-changes", "-e", ssh, `${DIST_SERVER}/datapacks/`, `${target}${LEVEL_NAME}/datapacks/`], 300_000);
    if (r.code !== 0) return { ok: false, lines: [...lines, `rsync datapacks failed (${r.code}):`, ...r.out.trim().split("\n").slice(-5)], restarted: false, dryRun };
    const n = r.out.split("\n").filter((l) => /^[<>ch*]/.test(l) && !/^cd/.test(l)).length;
    lines.push(n ? `datapacks: ${n} file(s) updated in ${LEVEL_NAME}/datapacks; restart the server for them to count` : "datapacks: up to date");
  } catch {
    /* none built */
  }
  // 3. restart if mods changed
  let restarted = false;
  if (modsChanged) {
    if (env.AMP_MOCK === "1") lines.push("AMP_MOCK=1: would call Core.Restart");
    else {
      await opts.beforeRestart?.().catch(() => undefined); // a running pre-generation is paused and saved first
      await amp.call("Core", "Restart");
      lines.push("Core.Restart sent");
    }
    restarted = true;
  }
  return { ok: true, lines, restarted, dryRun };
}
