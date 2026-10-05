import { readFile, rename, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { checkSides, clientSet, type ServerLoaded } from "./sides";
import { lintManifest } from "./lint";
import { verifyLinks } from "./verify-links";
import { buildBranding } from "./branding";
import { buildLock, diffLocks, type LockFile } from "./lock";
import { buildConfigZip, buildInstaller, buildServer, removeClientPack } from "./build";
import { modpackPaths } from "./paths";
import { buildItems } from "./items";
import { lockExtras, prepareExtrasLock } from "./extras";
import type { Manifest } from "./schema";
import { buildSeasons, loadSeasons } from "./seasons";
import { buildBuilds } from "./builds";

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
      // the season files too (docs/20 §4): a duplicate title or an unchecked entity stops CI as a bad mods.json does
      const seasons = await loadSeasons(P.seasons, P.items);
      for (const i of seasons.issues) log(`ERROR season ${i.season}: ${i.message}`);
      const errors = issues.filter((i) => i.level === "error").length + seasons.issues.length;
      log(`${P.manifest}: ${manifest ? `${manifest.mods.length} mods, ` : ""}${errors} error(s), ${issues.length - issues.filter((i) => i.level === "error").length} warning(s); ${seasons.seasons.length} season file(s), current ${seasons.index.current ?? "none"}, to the server: ${seasons.index.ship.join(", ") || "none"}`);
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
      const { lock, warnings } = await buildLock(manifest, { configDir: P.config, resourcepackDir: P.resourcepack, onProgress: log, previousNeoForge: prev?.neoforge, jarCache: path.join(P.dist, "cache", "lock-jars") });
      for (const w of warnings) log(`WARN  ${w}`);
      const d = diffLocks(prev, lock);
      const changed = d.added.length + d.removed.length + d.changed.length + d.configs.length + (d.neoforge ? 1 : 0);
      for (const c of d.configs) log(`~ settings ${c}`);
      for (const a of d.added) log(`+ ${a.slug} ${a.versionNumber}`);
      for (const r of d.removed) log(`- ${r.slug} ${r.versionNumber}`);
      for (const c of d.changed) log(`~ ${c.slug} ${c.from} -> ${c.to}`);
      if (d.neoforge) log(`~ neoforge ${d.neoforge.from} -> ${d.neoforge.to}`);
      // 2.1.0: sides, Modrinth's word on them and the jars' channels are written even when no version moved
      const meta = (l: LockFile) => JSON.stringify(l.files.map((f) => [f.slug, f.side, f.modrinth ?? null, f.channels ?? null]));
      if (prev && meta(prev) !== meta(lock)) log("~ sides / channels recorded");
      if (prev && changed === 0 && meta(prev) === meta(lock) && !rest.includes("--force")) {
        log(`mods.lock.json unchanged (${lock.files.length} files, NeoForge ${lock.neoforge}, hash ${lock.hash.slice(0, 8)})`);
        await lockExtras(P, lock, manifest.loader, log);
        process.exit(0);
      }
      // docs/35 R-43: both locks are worked out first, then both renamed into place. The pack's lock used to be in
      // place before the extras were asked for, so an extras failure left a new mods.lock.json beside an old extras lock.
      const tmp = `${P.lock}.tmp`;
      await writeFile(tmp, JSON.stringify(lock, null, 2) + "\n");
      const extras = await prepareExtrasLock(P, lock, manifest.loader, log).catch(async (e: unknown) => {
        await rm(tmp, { force: true });
        throw e;
      });
      await rename(tmp, P.lock);
      log(`wrote ${P.lock}: ${lock.files.length} files, NeoForge ${lock.neoforge}, hash ${lock.hash.slice(0, 8)}`);
      await extras.commit();
      process.exit(0);
    }
    // falls through never
    // 2.1.0 (CI): every mod both sides need is on PCs; also against what the server loaded at its last start
    case "check-sides": {
      const lock = await requireLock();
      let loaded: ServerLoaded | null = null;
      try {
        loaded = JSON.parse(await readFile(path.join(path.dirname(P.lock), "server-loaded.json"), "utf8")) as ServerLoaded;
      } catch {
        log("no modpack/server-loaded.json: only the lock is checked");
      }
      const problems = checkSides(lock, loaded);
      for (const p of problems) console.error(`ERROR ${p.slug ?? p.filename}: ${p.why}`);
      const pcs = clientSet(lock).length;
      log(`${lock.files.length} files in the lock, ${pcs} for PCs, ${lock.files.length - pcs} server-only${loaded ? `; server loaded ${loaded.files.length} files at ${loaded.at} (${loaded.source})` : ""}: ${problems.length ? `${problems.length} problem(s)` : "sides OK"}`);
      process.exit(problems.length ? 1 : 0);
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
      await removeClientPack(P, log);
      // first: the logo's sizes, which the server (server-icon.png) and config.zip (window icon) take from
      if (what === "branding" || what === "all") await buildBranding(P.dist, log);
      if (what === "config" || what === "all") await buildConfigZip(P, log);
      if (what === "server" || what === "all") await buildServer(manifest, lock, P, log);
      // after the server's folder: buildServer makes datapacks/ afresh, the season datapacks go in on top
      if (what === "seasons" || what === "server" || what === "all") await buildSeasons(P, log);
      if (what === "builds" || what === "server" || what === "all") await buildBuilds(P, log);
      if (what === "installer" || what === "all") await buildInstaller(manifest, lock, P, portalUrl, log);
      // after the server jars: the item catalogue is read out of them (docs/13 §13)
      if (what === "items" || what === "all") await buildItems({ dist: P.dist, vanilla: P.items }, log);
      if (!["branding", "config", "server", "installer", "items", "seasons", "builds", "all"].includes(what)) {
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
      log(`usage: modpack <lint|verify-links|lock [--force]|check-sides|build [config|server|installer|items|seasons|all]> \nmanifest: ${P.manifest}\ndist: ${P.dist}`);
      process.exit(cmd === "help" ? 0 : 1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
