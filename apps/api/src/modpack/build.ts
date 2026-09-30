import { spawn } from "node:child_process";
import { access, constants, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import type { Env } from "../env.js";

// `modpack build` downloads the jars and zips the packs. It runs here, as a child process of api, so it
// sits under this container's memory limit (512 MB) instead of on the host: on 2026-09-29 unbounded work
// on the VPS ran it out of memory. The child's heap is capped below the container limit and it is marked
// as the first thing to kill, so a runaway build dies alone and api keeps serving.

export const BUILD_TARGETS = ["all", "config", "server", "installer", "items"] as const; // no "client": Windows only, no .mrpack (2026-09-29)
export type BuildTarget = (typeof BUILD_TARGETS)[number];
export type BuildEvent = { line: string } | { done: true; ok: boolean; code: number };

const HEAP_MB = 256;
const TIMEOUT_MS = 15 * 60_000;

export function buildCommand(env: Env, target: BuildTarget, packName?: string) {
  return {
    cmd: process.execPath,
    args: [`--max-old-space-size=${HEAP_MB}`, "--import", "tsx", "src/cli.ts", "build", target],
    cwd: env.MODPACK_PKG_DIR,
    // Only what the CLI needs: no service token, no AMP password, no database URL.
    env: {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
      NODE_ENV: "production",
      MODPACK_DIR: `${env.REPO_DIR}/modpack`,
      REPO_DIR: env.REPO_DIR,
      DIST_DIR: `${env.REPO_DIR}/dist`,
      AUTH_URL: env.PORTAL_URL,
      ...(env.MODRINTH_USER_AGENT ? { MODRINTH_USER_AGENT: env.MODRINTH_USER_AGENT } : {}),
      // Admin → Branding: the name the launcher profile and the pack are given
      ...(packName ? { PACK_NAME: packName } : {}),
    } as Record<string, string>,
  };
}

/** Runs the CLI and yields each output line as it is printed, then one `done` event. */
export async function* runBuild(
  env: Env,
  target: BuildTarget,
  opts: { timeoutMs?: number; command?: ReturnType<typeof buildCommand>; packName?: string } = {},
): AsyncGenerator<BuildEvent> {
  const c = opts.command ?? buildCommand(env, target, opts.packName);
  try {
    await access(c.env.DIST_DIR ?? `${env.REPO_DIR}/dist`, constants.W_OK);
  } catch {
    yield { line: `ERROR ${c.env.DIST_DIR} is not writable by api (uid ${process.getuid?.() ?? "?"}): run deploy/deploy.sh as root once, it fixes the owner` };
    yield { done: true, ok: false, code: 1 };
    return;
  }

  const child = spawn(c.cmd, c.args, { cwd: c.cwd, env: c.env, stdio: ["ignore", "pipe", "pipe"] });
  if (child.pid) void writeFile(`/proc/${child.pid}/oom_score_adj`, "1000").catch(() => {});

  const merged = new PassThrough();
  child.stdout.pipe(merged, { end: false });
  child.stderr.pipe(merged, { end: false });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, opts.timeoutMs ?? TIMEOUT_MS);
  const exit = new Promise<{ code: number; note?: string }>((resolve) => {
    child.on("error", (e) => {
      merged.end();
      resolve({ code: 127, note: `could not start the build: ${e.message}` });
    });
    child.on("close", (code, signal) => {
      merged.end();
      if (signal === "SIGKILL") resolve({ code: 137, note: timedOut ? "build timed out and was stopped" : "build was killed, most likely for using too much memory" });
      else resolve({ code: code ?? 1, note: signal ? `build stopped by ${signal}` : undefined });
    });
  });

  try {
    for await (const line of createInterface({ input: merged, crlfDelay: Infinity })) {
      if (line.trim() !== "") yield { line };
    }
    const { code, note } = await exit;
    if (note) yield { line: `ERROR ${note}` };
    else if (code !== 0) yield { line: `ERROR modpack build exited with code ${code}` };
    yield { done: true, ok: code === 0, code };
  } finally {
    clearTimeout(timer);
    // The caller went away (or we are done): never leave a build running unattended.
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
}
