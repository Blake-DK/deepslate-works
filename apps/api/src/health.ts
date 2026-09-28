import { connect } from "node:net";
import { execFile } from "node:child_process";
import type { Amp } from "./amp/client.js";
import type { Env } from "./env.js";

export type Health = { ok: boolean; tunnel: "ok" | "down"; amp: "ok" | "mock" | "unconfigured" | "unreachable" | "auth_failed"; rsync: "ok" | "unrestricted" | "no_key" | "down" };

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

/** The deploy key should only be allowed to run rrsync: a bare `true` must be *refused by rrsync* (ok). Exit 0 means the key has a full shell (unrestricted). */
function rsyncCheck(env: Env): Promise<Health["rsync"]> {
  return new Promise((resolve) => {
    const [user, host] = env.RSYNC_TARGET.replace(/:.*$/, "").split("@");
    execFile("ssh", ["-i", env.DEPLOY_KEY_PATH, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=3", `${user}@${host}`, "true"],
      { timeout: 8000 }, (err, _out, stderr) => {
        if (!err) return resolve("unrestricted"); // a bare command ran: the key has a full shell
        const code = (err as { code?: number | string }).code;
        const text = String(stderr);
        if (/no such file|not accessible|Load key/i.test(text)) return resolve("no_key");
        if (code === 255 || code === "ENOENT") return resolve("down");
        return resolve("ok"); // refused by the rrsync forced command: exactly what we want
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
  const value: Health = { ok: tunnelUp && (ampState === "ok" || ampState === "mock") && (rsync === "ok" || rsync === "unrestricted"), tunnel: tunnelUp ? "ok" : "down", amp: ampState, rsync };
  cache = { at: Date.now(), value };
  return value;
}
