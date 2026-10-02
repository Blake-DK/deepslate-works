import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { apiFetch } from "@/server/api-client";
import { getInstaller, getLock } from "@/server/modpack/lock";
import { getManifest } from "@/server/modpack/manifest";
import { shownAppVersion } from "@/lib/installer-info";

// Versions in the footers (planner, 2026-10-01). One source each, read at runtime or stamped at build:
//   portal (web, api): package.json's semver + the commit and build time CI stamps (PORTAL_COMMIT, PORTAL_BUILT_AT)
//   app: the version Build read from installer/VERSION into the download (dist/installer.json): the 3.x app, not the
//        old launcher (2.2.0) that installer.json's `version` still names (shownAppVersion)
//   pack: the lock (mods.json's version + the lock's hash, as the mod list gives it)
//   server: Minecraft and NeoForge from the running server's log, or the lock's when it is asleep ("from the pack")

export type Build = { app: "web" | "api"; version: string; commit: string | null; builtAt: string | null; startedAt: string };
export type Versions = {
  web: Build;
  api: Build | null;
  pack: string | null;
  app: string | null;
  server: { minecraft: string; neoforge: string; from: "server" | "pack" } | null;
};

const STARTED = new Date().toISOString();
const stamped = (v: string | undefined) => (v && v !== "dev" && /^[\w.:+-]{1,64}$/.test(v) ? v : null);

function ownVersion(): string {
  try {
    return (JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { name?: string; version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
const VERSION = ownVersion();

export function webBuild(env: Record<string, string | undefined> = process.env): Build {
  return { app: "web", version: VERSION, commit: stamped(env.PORTAL_COMMIT), builtAt: stamped(env.PORTAL_BUILT_AT), startedAt: STARTED };
}

let cache: { at: number; v: Versions } | null = null;

export async function getVersions(): Promise<Versions> {
  if (cache && Date.now() - cache.at < 30_000) return cache.v;
  const [api, lock, installer, m] = await Promise.all([
    apiFetch<{ api: Build; server: { minecraft: string; neoforge: string } | null }>("/version", { timeoutMs: 4000 }).catch(() => null),
    getLock(),
    getInstaller(),
    getManifest().catch(() => null),
  ]);
  const v: Versions = {
    web: webBuild(),
    api: api?.api ?? null,
    pack: lock && m ? `${m.version}+${lock.hash.slice(0, 8)}` : null,
    app: shownAppVersion(installer),
    server: api?.server ? { ...api.server, from: "server" } : lock ? { minecraft: lock.minecraft, neoforge: lock.neoforge, from: "pack" } : null,
  };
  cache = { at: Date.now(), v };
  return v;
}

/** Pure: what a visitor may see. The commits, build and deploy times are for admins. */
export function forViewer(v: Versions, admin: boolean): Versions {
  if (admin) return v;
  const strip = (b: Build): Build => ({ ...b, commit: null, builtAt: null, startedAt: "" });
  return { ...v, web: strip(v.web), api: v.api ? strip(v.api) : null };
}
