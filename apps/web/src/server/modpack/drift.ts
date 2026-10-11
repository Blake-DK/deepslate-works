import "server-only";
import { execFile } from "node:child_process";
import path from "node:path";
import { db } from "@/server/db";
import type { PackDrift } from "@/lib/pack-drift";
import { seasonIndexSchema, shipFor, shippedLock, type LockFile } from "modpack";

const MODPACK_DIR = process.env.MODPACK_DIR ?? path.resolve(process.cwd(), "..", "..", "modpack");
const REPO_DIR = process.env.REPO_DIR ?? path.resolve(MODPACK_DIR, "..");

/** A read-only git command in the deploy checkout; null when it fails. */
export function git(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["-C", REPO_DIR, "-c", `safe.directory=${REPO_DIR}`, ...args], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout));
  });
}

/**
 * origin/main's pack, "<mods.json version>+<lock hash, 8>", as of the checkout's last fetch (deploy.sh fetches): the
 * lock as this server ships it (docs/44), by main's index.json.
 */
async function mainPack(): Promise<string | null> {
  const [m, l, i] = await Promise.all(["mods.json", "mods.lock.json", "seasons/index.json"].map((f) => git(["show", `refs/remotes/origin/main:modpack/${f}`])));
  try {
    const version = (JSON.parse(m ?? "") as { version?: unknown }).version;
    const lock = JSON.parse(l ?? "") as LockFile;
    let ship: string[] = [];
    try {
      ship = seasonIndexSchema.parse(JSON.parse(i ?? "")).ship;
    } catch {
      // no index on main: nothing ships
    }
    const hash = typeof lock.hash === "string" && Array.isArray(lock.files) ? shippedLock(lock, shipFor(ship, process.env)).hash : null;
    return typeof version === "string" && hash ? `${version}+${hash.slice(0, 8)}` : null;
  } catch {
    return null;
  }
}

async function unpushed(): Promise<string[]> {
  const out = await git(["log", "--format=%h %s", "refs/remotes/origin/main..HEAD"]);
  return out ? out.split("\n").map((l) => l.trim()).filter(Boolean) : [];
}

async function serverPack(): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key: "_packSynced" } }).catch(() => null);
  const v = (row?.value as { version?: unknown } | null)?.version;
  return typeof v === "string" && v ? v : null;
}

export async function getPackDrift(): Promise<PackDrift> {
  const [server, main, commits] = await Promise.all([serverPack(), mainPack(), unpushed()]);
  return { server, main, unpushed: commits };
}
