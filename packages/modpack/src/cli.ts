import { readFile, rename, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { checkSides, clientSet, type ServerLoaded } from "./sides";
import { lintLock, lintManifest } from "./lint";
import { verifyLinks } from "./verify-links";
import { buildBranding } from "./branding";
import { buildLock, diffLocks, shippedLock, type LockFile } from "./lock";
import { applyTestOverlay, buildConfigZip, buildInstaller, buildServer, removeClientPack } from "./build";
import { modpackPaths } from "./paths";
import { buildItems } from "./items";
import { prepareExtrasLock, type ExtrasLock } from "./extras";
import type { Manifest } from "./schema";
import { buildSeasons, loadSeasons, readShip, shipNotice } from "./seasons";
import { buildBuilds } from "./builds";
import { designFile, designPrompt } from "./design-cli";
import { checkExtrasDependencies, checkPackDependencies, jarModsOnDisk, readLockJars, type DepProblem } from "./deps";
import { fetchJar } from "./download";

const [cmd = "help", ...rest] = process.argv.slice(2);
const P = modpackPaths();
const log = (s: string) => console.log(s);
const lockJars = path.join(P.dist, "cache", "lock-jars"); // Lock keeps every jar here to look into it

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

async function loadExtrasLock(): Promise<ExtrasLock | null> {
  try {
    return JSON.parse(await readFile(P.extrasLock, "utf8")) as ExtrasLock;
  } catch {
    return null;
  }
}

/**
 * deps.ts checkExtrasDependencies: the pack beside the Extras as locked and, when they differ, as PCs may still have
 * them (`before`). The Extras' jars are fetched into Lock's cache like the pack's.
 */
async function extrasProblems(lock: LockFile, now: ExtrasLock | null, before: ExtrasLock | null): Promise<DepProblem[]> {
  const sets = [
    ...(now ? [{ name: "every Extra on", extras: now }] : []),
    ...(before && before.hash !== now?.hash ? [{ name: "every Extra on, as PCs have them before they update", extras: before }] : []),
  ];
  if (!sets.length) return [];
  const jars = await readLockJars(lock, { cache: lockJars, privateDir: P.privateJars });
  for (const set of sets) {
    for (const f of set.extras.extras.flatMap((x) => x.files.filter((y) => y.kind === "mod"))) {
      if (jars.has(f.filename)) continue;
      const at = path.join(lockJars, f.filename);
      try {
        await fetchJar(f, at, log);
        jars.set(f.filename, jarModsOnDisk(at));
      } catch (e) {
        log(`WARN  extras: ${f.filename}: ${e instanceof Error ? e.message : String(e)}`);
        jars.set(f.filename, null);
      }
    }
  }
  return checkExtrasDependencies(lock, sets, jars);
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
      // the lock too, when there is one: every file it names is fetched by Build and by every PC
      const lock = await loadLock();
      if (lock) issues.push(...lintLock(lock));
      // deps.ts: Lock's check of what the mods need of each other, on the lock as it is, over the jars on this machine
      if (lock) {
        const jars = await readLockJars(lock, { cache: lockJars, privateDir: P.privateJars });
        if ([...jars.values()].some(Boolean)) issues.push(...checkPackDependencies(lock, jars));
        else issues.push({ level: "warn", message: `dependencies: not checked, none of the lock's jars is in ${lockJars} (\`modpack check-deps\` fetches them)` });
      }
      for (const i of issues) log(`${i.level.toUpperCase().padEnd(5)} ${i.message}`);
      // the season files too (docs/20 §4): a duplicate title or an unchecked entity stops CI as a bad mods.json does
      const seasons = await loadSeasons(P.seasons, P.items);
      for (const i of seasons.issues) log(`ERROR season ${i.season}: ${i.message}`);
      const errors = issues.filter((i) => i.level === "error").length + seasons.issues.length;
      log(`${P.manifest}: ${manifest ? `${manifest.mods.length} mods, ` : ""}${errors} error(s), ${issues.length - issues.filter((i) => i.level === "error").length} warning(s);${lock ? ` lock: ${lock.files.length} files;` : ""} ${seasons.seasons.length} season file(s), current ${seasons.index.current ?? "none"}, to the server: ${seasons.index.ship.join(", ") || "none"}`);
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
      const { lock, warnings } = await buildLock(manifest, { configDir: P.config, resourcepackDir: P.resourcepack, onProgress: log, previousNeoForge: prev?.neoforge, jarCache: lockJars, privateDir: P.privateJars, previous: prev });
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
      // 2026-10-26: the pack beside the Extras, as locked now and as PCs still have them; an error writes nothing
      const extrasBefore = await loadExtrasLock();
      const extrasStop = async (now: ExtrasLock | null) => {
        const problems = await extrasProblems(lock, now, extrasBefore);
        for (const p of problems) log(`${p.level.toUpperCase().padEnd(5)} ${p.message}`);
        return problems.some((p) => p.level === "error");
      };
      if (prev && changed === 0 && meta(prev) === meta(lock) && !rest.includes("--force")) {
        log(`mods.lock.json unchanged (${lock.files.length} files, NeoForge ${lock.neoforge}, hash ${lock.hash.slice(0, 8)})`);
        const extras = await prepareExtrasLock(P, lock, manifest.loader, log);
        if (await extrasStop(extras.lock)) {
          await rm(`${P.extrasLock}.tmp`, { force: true });
          console.error("Lock stopped: the pack and the Extras do not fit together (above). Nothing written.");
          process.exit(1);
        }
        await extras.commit();
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
      if (await extrasStop(extras.lock)) {
        await rm(tmp, { force: true });
        await rm(`${P.extrasLock}.tmp`, { force: true });
        console.error("Lock stopped: the pack and the Extras do not fit together (above). Nothing written.");
        process.exit(1);
      }
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
    // deps.ts: the lock as committed, every jar fetched into Lock's cache first (Modrinth's checked by sha512, private
    // ones copied from data/private-jars/); what the mods need of each other, as Lock checks it
    case "check-deps": {
      const lock = await requireLock();
      for (const f of lock.files) {
        try {
          await fetchJar(f, path.join(lockJars, f.filename), log, { privateDir: P.privateJars });
        } catch (e) {
          log(`WARN  ${f.slug}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const problems = [...checkPackDependencies(lock, await readLockJars(lock, { cache: lockJars })), ...(await extrasProblems(lock, await loadExtrasLock(), null))];
      for (const p of problems) log(`${p.level.toUpperCase().padEnd(5)} ${p.message}`);
      const errors = problems.filter((p) => p.level === "error").length;
      log(`${lock.files.length} files in the lock (NeoForge ${lock.neoforge}): ${errors ? `${errors} error(s)` : "dependencies OK"}, ${problems.length - errors} warning(s)`);
      process.exit(errors ? 1 : 0);
    }
    // falls through never
    case "build": {
      const what = rest[0] ?? "all";
      // docs/42 T5: what SEASONS_SHIP does here is the build's first line
      const ship = ["seasons", "server", "all"].includes(what) ? shipNotice(process.env) : null;
      if (ship) log(ship);
      const loaded = await loadManifest();
      // PACK_NAME: the server's name from Admin → Branding, when the build runs inside api
      const manifest = process.env.PACK_NAME?.trim() ? { ...loaded, name: process.env.PACK_NAME.trim().slice(0, 40) } : loaded;
      // docs/44: the server and its PCs get the files of the seasons this server ships, and the pack's version is theirs
      const full = await requireLock();
      const lock = shippedLock(full, await readShip(P.seasons));
      const out = full.files.filter((f) => !lock.files.includes(f));
      if (out.length) log(`season mods left out (their season is not shipped here): ${out.map((f) => `${f.slug} (${f.season})`).join(", ")}`);
      await mkdir(P.dist, { recursive: true });
      const portalUrl = process.env.AUTH_URL ?? process.env.PORTAL_URL ?? "https://deepslate.dsw.test";
      await removeClientPack(P, log);
      // first: the logo's sizes, which the server (server-icon.png) and config.zip (window icon) take from
      if (what === "branding" || what === "all") await buildBranding(P.dist, log);
      if (what === "config" || what === "all") await buildConfigZip(P, log);
      if (what === "server" || what === "all") await buildServer(manifest, lock, P, log);
      // after the server's folder: buildServer makes datapacks/ afresh, the season datapacks go in on top
      if (what === "seasons" || what === "server" || what === "all") await buildSeasons(P, log);
      if (what === "builds" || what === "server" || what === "all") await buildBuilds(P, log);
      // docs/42 T6: the test server's own differences, last, over everything above
      if (process.env.TEST_MODE === "1" && (what === "server" || what === "all")) await applyTestOverlay(P, log);
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
    // docs/39 Step 0: a recipe file into <name>.nbt and two pictures; the designer's whole system prompt
    case "design": {
      if (!rest[0]) {
        console.error("usage: modpack design <recipe.json> [out dir]");
        process.exit(1);
      }
      const base = process.env.INIT_CWD ?? process.cwd(); // pnpm runs the CLI in packages/modpack
      await designFile(path.resolve(base, rest[0]), rest[1] ? path.resolve(base, rest[1]) : path.join(P.dist, "designs"), P.root, log);
      process.exit(0);
    }
    // falls through never
    case "design-prompt":
      process.stdout.write(await designPrompt(P));
      process.exit(0);
    // falls through never
    case "sync-server":
      log("sync-server runs inside the api container (it owns the tunnel and the deploy key): POST /modpack/sync via the admin page.");
      process.exit(2);
    // falls through never
    default:
      log(`usage: modpack <lint|verify-links|lock [--force]|check-sides|check-deps|build [config|server|installer|items|seasons|all]|design <recipe.json> [out]|design-prompt> \nmanifest: ${P.manifest}\ndist: ${P.dist}`);
      process.exit(cmd === "help" ? 0 : 1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
