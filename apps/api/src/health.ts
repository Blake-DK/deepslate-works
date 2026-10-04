import { connect } from "node:net";
import { execFile } from "node:child_process";
import type { Amp } from "./amp/client.js";
import type { Env } from "./env.js";
import { sshCommand } from "./modpack/ssh.js";

export type Health = { ok: boolean; tunnel: "ok" | "down"; amp: "ok" | "mock" | "unconfigured" | "unreachable" | "auth_failed"; rsync: "ok" | "wrong_root" | "no_key" | "down" };

/** TCP connect to sshd on the AMP host: up means the tunnel carries traffic. */
export function tcpReachable(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ host, port });
    const done = (v: boolean) => { s.destroy(); resolve(v); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

/**
 * Deploy key check (docs/13 §4, verified 2026-09-28): list the remote root with the key pinned. rrsync roots the
 * key at the instance's Minecraft/ dir, so the listing must contain server.properties and mods/. A bare `ssh true`
 * is not a reliable test (it returned 0 with no output on the AMP host even though rrsync is in force).
 */
function rsyncCheck(env: Env): Promise<Health["rsync"]> {
  return new Promise((resolve) => {
    const target = env.RSYNC_TARGET.endsWith(":") ? env.RSYNC_TARGET : `${env.RSYNC_TARGET}:`;
    const ssh = sshCommand(env.DEPLOY_KEY_PATH, 3);
    execFile("rsync", ["-e", ssh, "--list-only", target], { timeout: 12000 }, (err, stdout, stderr) => {
      const text = `${stdout}${stderr}`;
      if (/no such file|not accessible|Load key/i.test(String(stderr))) return resolve("no_key");
      if (err) return resolve("down");
      const hasProps = /\bserver\.properties\b/.test(text);
      const hasMods = /\bmods\b/.test(text);
      return resolve(hasProps && hasMods ? "ok" : "wrong_root");
    });
  });
}

let cache: { at: number; value: Health } | null = null;

export async function health(env: Env, amp: Amp): Promise<Health> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const tunnelUp = await tcpReachable(env.AMP_TUNNEL_IP, 22);
  let ampState: Health["amp"];
  if (env.AMP_MOCK === "1") ampState = "mock";
  else if (!env.AMP_INSTANCE_ID || !env.AMP_PASSWORD) ampState = "unconfigured";
  else if (!tunnelUp) ampState = "unreachable";
  else {
    try { await amp.ping(); ampState = "ok"; } catch (e) { ampState = /login failed/i.test(String(e)) ? "auth_failed" : "unreachable"; }
  }
  const rsync = tunnelUp ? await rsyncCheck(env) : "down";
  const value: Health = { ok: tunnelUp && (ampState === "ok" || ampState === "mock") && rsync === "ok", tunnel: tunnelUp ? "ok" : "down", amp: ampState, rsync };
  cache = { at: Date.now(), value };
  return value;
}
