import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import { db } from "../db.js";
import { audit } from "../audit.js";
import { chunks, stat } from "../files/browse.js";

// 2.1.0 (kanefinch's TaCZ kick, 2026-10-01): which mod files the server really loaded at its last start, against the
// set PCs are given. A mod the server loads that registers network channels has to be on every PC as well, or NeoForge
// refuses players at the handshake ("This channel is missing on the client side, but required on the server").
// Written down at every start (Setting "_serverMods"); `deploy/server-mods.sh` copies it into
// modpack/server-loaded.json, which CI compares with the lock (`modpack check-sides`).

export const SERVER_MODS_KEY = "_serverMods";
const READ_LIMIT = 8 * 1024 * 1024; // the mod list is written in the first seconds of a start

export type Loaded = { filename: string; nested: boolean };
export type LockLike = { files: Array<{ slug: string; name: string; filename: string; side: string; channels?: string | null; modrinth?: { client?: string; server?: string } | null }> };
export type Problem = { filename: string; slug: string | null; why: string };

/** `Found mod file "tacz-….jar" of type MOD with provider …`: every file NeoForge found, nested (jar-in-jar) ones marked. */
export function parseLoadedMods(log: string): Loaded[] {
  const out = new Map<string, Loaded>();
  for (const m of log.matchAll(/Found mod file "([^"\r\n]{1,200})"([^\r\n]*)/g)) {
    const filename = m[1]!.split(/[\\/]/).pop()!;
    if (!/\.jar$/i.test(filename)) continue;
    const nested = /JarInJar|jij|nested/i.test(m[2] ?? "");
    if (!out.has(filename)) out.set(filename, { filename, nested });
  }
  return [...out.values()];
}

/**
 * The mod ids the server loaded, from the "Mod List:" NeoForge writes at every start ("\t\tAlternate Current 1.9.0
 * (alternate_current)", one row per mod, minecraft and neoforge included). Empty when the log has no such list.
 * events/parse.ts (aboutModsNoLongerLoaded) uses them to know which namespaces no loaded mod has.
 */
export function parseModIds(log: string): string[] {
  const at = log.indexOf("Mod List:");
  if (at < 0) return [];
  const ids = new Set<string>();
  for (const line of log.slice(at).split(/\r?\n/).slice(1)) {
    if (line.trim() === "" || /^\s*Name Version \(Mod Id\)\s*$/.test(line)) continue;
    const m = /^\t\t.+ \(([a-z0-9_.-]{1,64})\)\s*$/.exec(line);
    if (!m) break;
    ids.add(m[1]!);
  }
  return [...ids];
}

/** Server-only is only right for a mod no PC needs: Modrinth says the client can do without it, and it has no required channels. */
export function serverOnlyIsSafe(e: LockLike["files"][number]): boolean {
  return e.modrinth?.client !== "required" && e.channels !== "required";
}

/** The files the server loaded that PCs are not given, and should be. Nested jars travel inside their parent. */
export function compareLoaded(loaded: Loaded[], lock: LockLike): Problem[] {
  const byFile = new Map(lock.files.map((f) => [f.filename, f]));
  const problems: Problem[] = [];
  for (const l of loaded) {
    if (l.nested || /^(neoforge|minecraft|server|client|fmlcore|fmlloader|javafmllanguage|lowcodelanguage|mclanguage)-/i.test(l.filename)) continue;
    const e = byFile.get(l.filename);
    if (!e) { problems.push({ filename: l.filename, slug: null, why: "the server loaded it but it is not in the pack's lock, so no PC gets it" }); continue; }
    if (e.side === "server" && !serverOnlyIsSafe(e)) problems.push({ filename: l.filename, slug: e.slug, why: e.channels === "required" ? "server-only in the lock, but it has network channels PCs must have" : "server-only in the lock, but Modrinth says the client needs it" });
  }
  return problems;
}

export class ServerMods {
  constructor(private readonly amp: Amp, private readonly repoDir: string, private readonly log: (o: unknown, m: string) => void) {}

  start(tail: ConsoleTail) {
    tail.on((e, info) => {
      if (e.type !== "started" || info.replay) return;
      setTimeout(() => void this.capture().catch((err) => this.log({ err: String(err) }, "server mods: capture failed")), 3000);
    });
  }

  private async read(file: string): Promise<string | null> {
    try {
      const entry = await stat(this.amp, file, []);
      const parts: Buffer[] = [];
      for await (const c of chunks(this.amp, file, entry.size, READ_LIMIT)) parts.push(c);
      return Buffer.concat(parts).toString("utf8");
    } catch {
      return null;
    }
  }

  async capture(): Promise<{ files: Loaded[]; problems: Problem[]; source: string; modIds: string[] } | null> {
    let source = "logs/latest.log";
    let text = (await this.read(source)) ?? "";
    let loaded = parseLoadedMods(text);
    if (loaded.length === 0) { source = "logs/debug.log"; text = (await this.read(source)) ?? ""; loaded = parseLoadedMods(text); }
    if (loaded.length === 0) { this.log({}, "server mods: no 'Found mod file' lines in latest.log or debug.log"); return null; }
    const lock = JSON.parse(await readFile(path.join(this.repoDir, "modpack", "mods.lock.json"), "utf8")) as LockLike;
    const problems = compareLoaded(loaded, lock);
    const modIds = parseModIds(text);
    const value = { at: new Date().toISOString(), source, files: loaded, problems, modIds } as unknown as Prisma.InputJsonValue;
    await db.setting.upsert({ where: { key: SERVER_MODS_KEY }, create: { key: SERVER_MODS_KEY, value }, update: { value } });
    this.log({ files: loaded.length, problems: problems.length, modIds: modIds.length, source }, "server mods: captured");
    if (problems.length) await audit({ action: "modpack.serverMods", params: { files: loaded.length, problems: problems.map((p) => `${p.filename}: ${p.why}`).slice(0, 20) }, result: "FAILED" });
    return { files: loaded, problems, source, modIds };
  }
}
