import type { LockEntry, LockFile } from "./lock";
import type { ModrinthProject } from "./modrinth";
import type { Zip } from "./zip";
import { openZip } from "./zip";

// 2.1.0 (kanefinch's TaCZ kick, 2026-10-01): which side a mod belongs on, and the checks that keep a mod both sides
// need from ever being server-only. NeoForge refuses a player at the handshake when the server has a mod with required
// network channels that their game lacks ("This channel is missing on the client side, but required on the server").

export type Side = LockEntry["side"];
export type Channels = "required" | "optional" | "none";

/** From Modrinth's client_side / server_side: unsupported on one side puts it on the other only. */
export function sideFromProject(p: Pick<ModrinthProject, "client_side" | "server_side">): Side {
  if (p.client_side === "unsupported") return "server";
  if (p.server_side === "unsupported") return "client";
  return "both";
}

/**
 * The side in the lock. mods.json may narrow a mod to one side (chunky and spark are server-only although Modrinth
 * calls the client "optional"), but never to a side that leaves out one Modrinth says requires it.
 */
export function sideFor(slug: string, p: Pick<ModrinthProject, "client_side" | "server_side">, override: Side | undefined): Side {
  const base = sideFromProject(p);
  if (!override || override === "both") return base;
  if (override === "server" && p.client_side === "required") throw new Error(`${slug}: mods.json says server-only, but Modrinth says the client requires it (client_side: required). Anything both sides need is never server-only.`);
  if (override === "client" && p.server_side === "required") throw new Error(`${slug}: mods.json says client-only, but Modrinth says the server requires it (server_side: required).`);
  return override;
}

/**
 * A library takes the sides of what needs it: required by a mod that is on PCs, it is on PCs too (and the same for
 * the server). One that cannot go where it is needed (Modrinth says "unsupported" there) is an error.
 */
export function widenForDependents(entries: LockEntry[], warn: (w: string) => void = () => {}): void {
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  const onClient = (s: Side) => s !== "server";
  const onServer = (s: Side) => s !== "client";
  const said = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const e of entries) {
      for (const by of e.requiredBy) {
        const parent = bySlug.get(by);
        if (!parent) continue;
        if (onClient(parent.side) && !onClient(e.side)) {
          if (e.modrinth?.client === "unsupported") throw new Error(`${e.slug}: ${by} needs it on PCs, but Modrinth says it does not run on the client`);
          e.side = "both"; changed = true;
        }
        if (onServer(parent.side) && !onServer(e.side)) {
          // docs/31 B-26: a client-only library of a mod that runs on both sides (Fusion under Rechiseled) stays on
          // PCs. The server cannot load it and the mod does without it there. It used to stop the whole Lock, so
          // one votable mod winning made the pack unlockable.
          if (e.modrinth?.server === "unsupported") {
            if (!said.has(`${e.slug}<${by}`)) warn(`${e.slug}: ${by} runs on the server too, but this library is client-only on Modrinth; it stays on PCs`);
            said.add(`${e.slug}<${by}`);
            continue;
          }
          e.side = "both"; changed = true;
        }
      }
    }
  }
}

const REGISTRAR = Buffer.from("net/neoforged/neoforge/network/registration/PayloadRegistrar");
const OPTIONAL = Buffer.from("\u0000\u0008optional"); // the method name in a class file's constant pool

/**
 * Does the jar register NeoForge network channels, and are they all optional? A class that uses PayloadRegistrar and
 * never calls `optional()` registers required ones. Jar-in-jar libraries are looked into too. A heuristic over the
 * class files, good enough to stop a server-only mod with channels: it is what found TaCZ's two handshake channels.
 */
export function jarChannels(zip: Zip, depth = 0): Channels {
  let found: Channels = "none";
  for (const name of zip.names) {
    if (name.endsWith(".class")) {
      const b = zip.read(name);
      if (!b || b.indexOf(REGISTRAR) < 0) continue;
      if (b.indexOf(OPTIONAL) < 0) return "required";
      found = "optional";
    } else if (name.endsWith(".jar") && depth < 2) {
      const inner = zip.read(name);
      if (!inner) continue;
      try {
        const c = jarChannels(openZip(inner), depth + 1);
        if (c === "required") return "required";
        if (c === "optional") found = "optional";
      } catch {
        // not a zip after all: nothing to look at
      }
    }
  }
  return found;
}

/** The mods PCs get: everything but server-only (the installer takes `side !== "server"` from the mod list). */
export const clientSet = (lock: Pick<LockFile, "files">) => lock.files.filter((f) => f.side !== "server");

export type ServerLoaded = { at: string; source: string; files: Array<{ filename: string; nested?: boolean }> };
export type SideProblem = { slug: string | null; filename: string; why: string };

/**
 * The check CI runs (`modpack check-sides`): every mod both sides need is on PCs, by what Modrinth says, by what the
 * jar registers, and by what the server really loaded at its last start (modpack/server-loaded.json, from api).
 */
export function checkSides(lock: Pick<LockFile, "files">, loaded: ServerLoaded | null): SideProblem[] {
  const problems: SideProblem[] = [];
  for (const e of lock.files) {
    if (e.side === "server" && e.modrinth?.client === "required") problems.push({ slug: e.slug, filename: e.filename, why: "server-only, but Modrinth says the client requires it" });
    if (e.side === "server" && e.channels === "required") problems.push({ slug: e.slug, filename: e.filename, why: "server-only, but it registers network channels PCs must have" });
    if (e.side === "client" && e.modrinth?.server === "required") problems.push({ slug: e.slug, filename: e.filename, why: "client-only, but Modrinth says the server requires it" });
  }
  if (loaded) {
    const byFile = new Map(lock.files.map((f) => [f.filename, f]));
    for (const l of loaded.files) {
      if (l.nested || /^(neoforge|minecraft|server|client|fmlcore|fmlloader|javafmllanguage|lowcodelanguage|mclanguage)-/i.test(l.filename)) continue;
      const e = byFile.get(l.filename);
      // a jar the server loaded that the lock does not know: it may be from before the last Lock (CI compares with
      // the lock as committed); flagged, because nobody's PC gets it
      if (!e) problems.push({ slug: null, filename: l.filename, why: `the server loaded it at ${loaded.at}, but it is not in the lock, so no PC gets it` });
    }
  }
  return problems;
}
