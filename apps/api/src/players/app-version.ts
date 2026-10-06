import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { installerInfo, requiredInstaller } from "../shared/installer-info.js";

// The app a run of Play has to come from to let anyone in (Alex, 2026-10-06): the newest the site hands out, read from
// dist/ the way web reads it (server/modpack/lock.ts getInstaller), so the door never asks for a version the site
// cannot give. Looked at on every join and every 5 s for whoever is held: kept for half a minute.

const DIST = path.join(process.env.REPO_DIR ?? "/repo", "dist");
const KEEP_MS = 30_000;

async function sum(file: string): Promise<{ sha256: string; size: number } | null> {
  try {
    const b = await readFile(file);
    return { sha256: createHash("sha256").update(b).digest("hex"), size: b.length };
  } catch {
    return null;
  }
}

/** The version of the app players need, or "" when the site has no installer that checks out (nobody is held for it). */
export async function readRequiredApp(dist = DIST): Promise<string> {
  try {
    const sidecar: unknown = JSON.parse(await readFile(path.join(dist, "installer.json"), "utf8"));
    const [zip, exe] = await Promise.all([sum(path.join(dist, "installer.zip")), sum(path.join(dist, "DeepslateWorks.exe"))]);
    return requiredInstaller(installerInfo(sidecar, zip, null, exe));
  } catch {
    return "";
  }
}

let kept: { at: number; version: string } | null = null;

export async function requiredApp(now = Date.now()): Promise<string> {
  if (kept && now - kept.at < KEEP_MS) return kept.version;
  kept = { at: now, version: await readRequiredApp() };
  return kept.version;
}
