import "server-only";
import { execFile } from "node:child_process";
import path from "node:path";
import { db } from "@/server/db";
import type { PackDrift } from "@/lib/pack-drift";

const MODPACK_DIR = process.env.MODPACK_DIR ?? path.resolve(process.cwd(), "..", "..", "modpack");
const REPO_DIR = process.env.REPO_DIR ?? path.resolve(MODPACK_DIR, "..");

function git(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["-C", REPO_DIR, "-c", `safe.directory=${REPO_DIR}`, ...args], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout));
  });
}

/** origin/main's pack, "<mods.json version>+<lock hash, 8>", as of the checkout's last fetch (deploy.sh fetches). */
async function mainPack(): Promise<string | null> {
  const [m, l] = await Promise.all([git(["show", "refs/remotes/origin/main:modpack/mods.json"]), git(["show", "refs/remotes/origin/main:modpack/mods.lock.json"])]);
  try {
    const version = (JSON.parse(m ?? "") as { version?: unknown }).version;
    const hash = (JSON.parse(l ?? "") as { hash?: unknown }).hash;
    return typeof version === "string" && typeof hash === "string" ? `${version}+${hash.slice(0, 8)}` : null;
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
