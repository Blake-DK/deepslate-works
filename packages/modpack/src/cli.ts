import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import { lintManifest } from "./lint";
import { verifyLinks } from "./verify-links";
import { buildLock, diffLocks, type LockFile } from "./lock";
import { buildClient, buildConfigZip, buildInstaller, buildServer } from "./build";
import { modpackPaths } from "./paths";
import type { Manifest } from "./schema";

const [cmd = "help", ...rest] = process.argv.slice(2);
const P = modpackPaths();
const log = (s: string) => console.log(s);

async function loadManifest(): Promise<Manifest> {
  const { manifest, issues } = lintManifest(JSON.parse(await readFile(P.manifest, "utf8")));
  const errors = issues.filter((i) => i.level === "error");
  if (!manifest || errors.length) {
    for (const i of errors) console.error(`ERROR ${i.message}`);
    process.exit(1);
  }
  return manifest;
}

async function loadLock(): Promise<LockFile | null> {
  try {
    return JSON.parse(await readFile(P.lock, "utf8")) as LockFile;
  } catch {
    return null;
  }
}

async function requireLock(): Promise<LockFile> {
  const lock = await loadLock();
  if (!lock) {
    console.error(`No ${P.lock}. Run \`modpack lock\` first.`);
    process.exit(1);
  }
  return lock;
}

async function main() {
  switch (cmd) {
    case "lint": {
      const { manifest, issues } = lintManifest(JSON.parse(await readFile(P.manifest, "utf8")));
      for (const i of issues) log(`${i.level.toUpperCase().padEnd(5)} ${i.message}`);
      const errors = issues.filter((i) => i.level === "error").length;
      log(`${P.manifest}: ${manifest ? `${manifest.mods.length} mods, ` : ""}${errors} error(s), ${issues.length - errors} warning(s)`);
      process.exit(errors ? 1 : 0);
    }
    // falls through never
    case "verify-links": {
      const manifest = await loadManifest();
      const results = await verifyLinks(manifest, { onResult: (r) => log(`${r.ok ? "ok  " : "FAIL"} ${r.kind.padEnd(8)} ${r.slug.padEnd(26)} ${r.status} ${r.url}`) });
      const failed = results.filter((r) => !r.ok);
      log(`${results.length} links checked, ${failed.length} failed`);
      process.exit(failed.length ? 1 : 0);
    }
    // falls through never
    case "lock": {
      const manifest = await loadManifest();
      const prev = await loadLock();
      const { lock, warnings } = await buildLock(manifest, { configDir: P.config, onProgress: log });
      for (const w of warnings) log(`WARN  ${w}`);
      const d = diffLocks(prev, lock);
      const changed = d.added.length + d.removed.length + d.changed.length + (d.neoforge ? 1 : 0);
      for (const a of d.added) log(`+ ${a.slug} ${a.versionNumber}`);
      for (const r of d.removed) log(`- ${r.slug} ${r.versionNumber}`);
      for (const c of d.changed) log(`~ ${c.slug} ${c.from} -> ${c.to}`);
      if (d.neoforge) log(`~ neoforge ${d.neoforge.from} -> ${d.neoforge.to}`);
      if (prev && changed === 0 && !rest.includes("--force")) {
        log(`mods.lock.json unchanged (${lock.files.length} files, NeoForge ${lock.neoforge}, hash ${lock.hash.slice(0, 8)})`);
        process.exit(0);
      }
      const tmp = `${P.lock}.tmp`;
      await writeFile(tmp, JSON.stringify(lock, null, 2) + "\n");
      await rename(tmp, P.lock);
      log(`wrote ${P.lock}: ${lock.files.length} files, NeoForge ${lock.neoforge}, hash ${lock.hash.slice(0, 8)}`);
      process.exit(0);
    }
    // falls through never
    case "build": {
      const what = rest[0] ?? "all";
      const loaded = await loadManifest();
      // PACK_NAME: the server's name from Admin → Branding, when the build runs inside api
      const manifest = process.env.PACK_NAME?.trim() ? { ...loaded, name: process.env.PACK_NAME.trim().slice(0, 40) } : loaded;
      const lock = await requireLock();
      await mkdir(P.dist, { recursive: true });
      const portalUrl = process.env.AUTH_URL ?? "https://deepslate.dsw.test";
      if (what === "client" || what === "all") {
        await buildClient(manifest, lock, P, log);
        await buildConfigZip(P, log);
      }
      if (what === "server" || what === "all") await buildServer(manifest, lock, P, log);
      if (what === "installer" || what === "all") await buildInstaller(manifest, lock, P, portalUrl, log);
      if (!["client", "server", "installer", "all"].includes(what)) {
        console.error(`unknown build target ${what}`);
        process.exit(1);
      }
      log(`dist: ${P.dist}`);
      process.exit(0);
    }
    // falls through never
    case "sync-server":
      log("sync-server runs inside the api container (it owns the tunnel and the deploy key): POST /modpack/sync via the admin page.");
      process.exit(2);
    // falls through never
    default:
      log(`usage: modpack <lint|verify-links|lock [--force]|build [client|server|installer|all]> \nmanifest: ${P.manifest}\ndist: ${P.dist}`);
      process.exit(cmd === "help" ? 0 : 1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
