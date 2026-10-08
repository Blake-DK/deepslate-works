import "server-only";
import { rename, writeFile } from "node:fs/promises";
import { buildLock, diffLocks, lintManifest, lockExtras, type LockFile } from "modpack";
import { getManifest, commitManifest } from "./manifest";
import { getLock, P } from "./lock";
import { apiFetch, apiStream } from "@/server/api-client";
import { testRefusal } from "@/server/test-mode";

export type Cmd = "lock" | "build" | "sync" | "sync-dry";
export const CMDS: Cmd[] = ["lock", "build", "sync", "sync-dry"];

let running: Cmd | null = null;
export const isRunning = () => running;

/** Runs one modpack command, streaming log lines. Only one at a time. */
export async function* runModpack(cmd: Cmd, admin: { id: string; displayName: string; role: "ADMIN" | "PLAYER" }): AsyncGenerator<string> {
  if (running) {
    yield `busy: ${running} is still running`;
    return;
  }
  running = cmd;
  try {
    // docs/42 T3: the lock on the test site is whatever its checkout has
    if (cmd === "lock" && testRefusal()) {
      yield `${testRefusal()}: the lock here is the test checkout's (deploy/test-pull.sh brings it to origin/dev)`;
      return;
    }
    if (cmd === "lock") {
      const m = await getManifest();
      const prev = await getLock();
      const lines: string[] = [];
      const { lock, warnings } = await buildLock(m, { configDir: P.config, resourcepackDir: P.resourcepack, onProgress: (s) => lines.push(s), previousNeoForge: prev?.neoforge });
      for (const l of lines) yield l;
      for (const w of warnings) yield `WARN ${w}`;
      const d = diffLocks(prev, lock);
      for (const a of d.added) yield `+ ${a.slug} ${a.versionNumber}`;
      for (const r of d.removed) yield `- ${r.slug} ${r.versionNumber}`;
      for (const c of d.changed) yield `~ ${c.slug} ${c.from} -> ${c.to}`;
      if (d.neoforge) yield `~ neoforge ${d.neoforge.from} -> ${d.neoforge.to}`;
      for (const c of d.configs) yield `~ settings ${c}`;
      const changed = d.added.length + d.removed.length + d.changed.length + d.configs.length + (d.neoforge ? 1 : 0);
      // The app's extras (modpack/extras.json) are locked with the pack, into a file of their own.
      const extraLines: string[] = [];
      const ex = await lockExtras(P, prev && changed === 0 ? prev : lock, m.loader, (s) => extraLines.push(s));
      for (const l of extraLines) yield l;
      if (prev && changed === 0) {
        yield `mods.lock.json unchanged (${lock.files.length} files, NeoForge ${lock.neoforge}, ${lock.hash.slice(0, 8)})`;
        if (ex.written) {
          const c = await commitManifest("chore(modpack): lock the extras", { name: admin.displayName }, ["modpack/extras.lock.json"]);
          yield c.ok ? `committed (${c.output || "ok"})` : `git commit failed: ${c.output}`;
        }
        return;
      }
      await writeFile(`${P.lock}.tmp`, JSON.stringify(lock, null, 2) + "\n");
      await rename(`${P.lock}.tmp`, P.lock);
      yield `wrote mods.lock.json: ${lock.files.length} files, NeoForge ${lock.neoforge}, ${lock.hash.slice(0, 8)}`;
      const commit = await commitManifest(`chore(modpack): lock ${lock.hash.slice(0, 8)} (${changed} change${changed === 1 ? "" : "s"})`, { name: admin.displayName }, ["modpack/mods.lock.json", ...(ex.written ? ["modpack/extras.lock.json"] : [])]);
      yield commit.ok ? `committed (${commit.output || "ok"})` : `git commit failed: ${commit.output}`;
    } else if (cmd === "build") {
      const lock = await getLock();
      if (!lock) {
        yield "no mods.lock.json yet: run Lock first";
        return;
      }
      // The build (jar downloads, zips) runs in the api container under its memory cap, never in this process.
      type BuildEvent = { line: string } | { done: true; ok: boolean; code: number };
      let finished = false;
      for await (const e of apiStream<BuildEvent>("/modpack/build", { method: "POST", body: { target: "all" }, caller: { id: admin.id, role: admin.role }, timeoutMs: 960_000 })) {
        if ("line" in e) yield e.line;
        else {
          finished = true;
          if (!e.ok) yield `ERROR build failed (exit ${e.code})`;
        }
      }
      if (!finished) yield "ERROR the build stream ended early: check `docker logs deepslate-api`";
    } else if (cmd === "sync" || cmd === "sync-dry") {
      const dryRun = cmd === "sync-dry";
      const lock = await getLock();
      if (!lock) {
        yield "no mods.lock.json yet: run Lock, then Build";
        return;
      }
      yield dryRun ? "asking api what a sync would change (dry run)…" : "asking api to rsync dist/server to the AMP host…";
      const res = await apiFetch<{ ok: boolean; lines: string[]; restarted: boolean }>("/modpack/sync", { method: "POST", body: { packVersion: lock.hash.slice(0, 8), dryRun }, caller: { id: admin.id, role: admin.role }, timeoutMs: 900_000 });
      for (const l of res.lines) yield l;
      if (!dryRun) yield res.restarted ? "server restart requested" : "mods unchanged: no restart";
    }
  } catch (e) {
    yield `ERROR ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    running = null;
  }
}

/** Lock status for the admin table: per mod, resolved version and any problem. */
export async function modpackStatus() {
  const m = await getManifest();
  const lock = await getLock();
  const bySlug = new Map((lock?.files ?? []).map((f) => [f.slug, f]));
  const { issues } = lintManifest(m);
  return {
    manifest: m,
    lock,
    issues,
    rows: m.mods.filter((mod) => !mod.hidden).map((mod) => {
      const f = bySlug.get(mod.slug);
      const status = !mod.enabled ? "off" : f ? (f.versionType === "release" ? "ok" : f.versionType) : lock ? "not locked" : "no lock";
      return { mod, version: f?.versionNumber ?? null, size: f?.size ?? null, status };
    }),
  };
}

export type LockInfo = LockFile;
