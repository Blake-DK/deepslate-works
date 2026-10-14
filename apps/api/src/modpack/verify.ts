import type { Loaded, LockLike, Problem } from "./server-mods.js";

// Alex, 2026-10-14: Sync says when it restarts the server, then checks that the server came back with every mod the
// pack gives it. What the server loaded is what NeoForge's "Found mod file" lines name at its start
// (modpack/server-mods.ts); what it should load is every file of the lock it ships that is not for PCs only.

export type Missing = { filename: string; slug: string };

/** The pack's server files the server did not load. Nested (jar-in-jar) files count by their own name. */
export function missingOnServer(loaded: Loaded[], lock: LockLike): { expected: number; missing: Missing[] } {
  const have = new Set(loaded.map((l) => l.filename));
  const want = lock.files.filter((f) => f.side !== "client");
  return { expected: want.length, missing: want.filter((f) => !have.has(f.filename)).map((f) => ({ filename: f.filename, slug: f.slug })) };
}

export type Capture = { at: Date; files: Loaded[]; problems: Problem[]; expected: number; missing: Missing[] };

/** What the check says, in the Sync log's words. */
export function checkLines(c: Pick<Capture, "files" | "problems" | "expected" | "missing">, which: string): string[] {
  const lines: string[] = [];
  if (c.missing.length === 0) lines.push(`checked ${which}: all ${c.expected} mods the pack gives the server are loaded`);
  else {
    lines.push(`ERROR ${which}: ${c.missing.length} of the pack's ${c.expected} server mods are not loaded`);
    for (const m of c.missing) lines.push(`  missing ${m.filename} (${m.slug})`);
  }
  for (const p of c.problems) lines.push(`WARN ${p.filename}: ${p.why}`);
  return lines;
}

export type VerifyDeps = {
  /** Reads the server's log of its last start now; null when it cannot be read. */
  capture: () => Promise<Capture | null>;
  /** The newest capture made at a start (ServerMods does one a few seconds after each). */
  latest: () => Capture | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

/**
 * `since` (after a restart): waits for a start after that moment, then checks it. Without: checks the server's last
 * start as its log has it.
 */
export async function verifyServer(deps: VerifyDeps, since?: Date): Promise<{ ok: boolean; lines: string[] }> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  if (since) {
    const limit = deps.timeoutMs ?? 6 * 60_000;
    const from = now();
    for (;;) {
      const c = deps.latest();
      if (c && c.at.getTime() > since.getTime()) {
        const s = Math.round((c.at.getTime() - since.getTime()) / 1000);
        return { ok: c.missing.length === 0, lines: [`the server is back up (${s} s after the restart)`, ...checkLines(c, "its start")] };
      }
      if (now() - from >= limit) return { ok: false, lines: [`ERROR the server has not come back up within ${Math.round(limit / 60_000)} minute${Math.round(limit / 60_000) === 1 ? "" : "s"} of the restart: look at Admin → Server`] };
      await sleep(2000);
    }
  }
  const c = await deps.capture();
  if (!c) return { ok: false, lines: ["WARN could not read the server's log, so its mods were not checked"] };
  return { ok: c.missing.length === 0, lines: checkLines(c, "the server's last start") };
}
