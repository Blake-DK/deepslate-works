import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Amp } from "../amp/client.js";
import { newestDump } from "../backup/dump-push.js";
import { readBackups } from "../routes/server.js";
import { SignInWatch, type SignInMethod } from "./signin-watch.js";

// docs/32 §7 item 3 (planner, 2026-10-04): the things that fail without anybody being told. On 2026-10-04 the
// site handed out a pack the server refused for hours (docs/31 B-01), no database dump had ever left the VPS
// (B-07), and a wake failed with a player waiting (B-66); each was visible somewhere and nobody was looking.
//
// Every ten minutes the watch looks at each of them. What it finds is in api's /health (`checks`), and when one
// goes from well to wrong an ERROR event is written, which the Discord feed posts to the admin channel; when it
// is well again, a WARN event says so. `ok: null` means "could not be looked at" (AMP out of reach): never an
// alert of its own, the tunnel and AMP have their own.

export const DUMP_MAX_AGE_H = 26; // nightly at 00:00 UTC, two hours of grace
export const COPY_GRACE_MIN = 60; // api looks every ten minutes
export const BACKUP_MAX_AGE_H = 30; // AMP's nightly backup at 01:00 UTC
/** docs/28 amendments 13 and 14 (2026-10-03): a 22-byte zip, and a backup a third too small, both listed as good. */
export const BACKUP_MIN_BYTES = 1024 ** 3;
export const BACKUP_SHRINK = 2 / 3;

export type Check = { ok: boolean | null; text: string };
export type CheckName = "dump" | "dumpCopy" | "backup" | "pack" | "wake";
export type Checks = Record<CheckName, Check>;

export type Inputs = {
  /** The newest nightly dump on the VPS; null when there is none, undefined when the folder cannot be read. */
  dump: { name: string; at: Date; bytes: number } | null | undefined;
  /** The dump api last copied to the AMP host (since api started). */
  copied: { name: string; at: Date } | null;
  /** AMP's backups, newest first by time; undefined when the list could not be read. */
  backups: Array<{ name: string; at: Date; bytes: number | null }> | undefined;
  /** The pack the site hands out (the checkout's lock) and the pack last synced to the server. */
  pack: { site: string | null; server: string | null };
  /** The last wake: who asked, and whether it failed. */
  wake: { failed: boolean; by: string | null; at: Date | null };
};

const hours = (ms: number) => Math.round(ms / 3_600_000);
const gb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);

/** Pure: what each check says, in the words the admin channel gets. */
export function evaluate(i: Inputs, now: Date): Checks {
  const t = now.getTime();
  const dump: Check = i.dump === undefined ? { ok: null, text: "The database dumps' folder cannot be read" }
    : i.dump === null ? { ok: false, text: "There is no database dump at all" }
    : i.dump.bytes < 10_000 ? { ok: false, text: `The newest database dump (${i.dump.name}) is only ${i.dump.bytes} bytes` }
    : t - i.dump.at.getTime() > DUMP_MAX_AGE_H * 3_600_000 ? { ok: false, text: `No database dump for ${hours(t - i.dump.at.getTime())} hours (the newest is ${i.dump.name})` }
    : { ok: true, text: `${i.dump.name}, ${hours(t - i.dump.at.getTime())} h old` };

  const dumpCopy: Check = !i.dump ? { ok: null, text: "No dump to copy" }
    : i.copied?.name === i.dump.name ? { ok: true, text: `${i.dump.name} is on the AMP host` }
    : t - i.dump.at.getTime() < COPY_GRACE_MIN * 60_000 ? { ok: true, text: `${i.dump.name} is new; its copy is due` }
    : { ok: false, text: `The database dump ${i.dump.name} has not been copied to the AMP host` };

  let backup: Check;
  if (i.backups === undefined) backup = { ok: null, text: "AMP's backup list could not be read" };
  else if (i.backups.length === 0) backup = { ok: false, text: "AMP lists no world backup at all" };
  else {
    const [newest, before] = i.backups;
    const age = t - newest!.at.getTime();
    if (age > BACKUP_MAX_AGE_H * 3_600_000) backup = { ok: false, text: `No world backup for ${hours(age)} hours (the newest is "${newest!.name}")` };
    else if (newest!.bytes !== null && newest!.bytes < BACKUP_MIN_BYTES) backup = { ok: false, text: `The newest world backup ("${newest!.name}") is only ${gb(newest!.bytes)}` };
    else if (newest!.bytes !== null && before?.bytes && newest!.bytes < before.bytes * BACKUP_SHRINK) backup = { ok: false, text: `The newest world backup ("${newest!.name}", ${gb(newest!.bytes)}) is much smaller than the one before it (${gb(before.bytes)})` };
    else backup = { ok: true, text: `"${newest!.name}", ${hours(age)} h old${newest!.bytes !== null ? `, ${gb(newest!.bytes)}` : ""}` };
  }

  const pack: Check = !i.pack.site || !i.pack.server ? { ok: null, text: "The pack on the site or on the server is not known" }
    : i.pack.site === i.pack.server ? { ok: true, text: i.pack.site }
    : { ok: false, text: `The site hands out pack ${i.pack.site} but the server runs ${i.pack.server}: with Play first on, nobody who presses Play gets in` };

  const wake: Check = i.wake.failed
    ? { ok: false, text: `The server did not wake when ${i.wake.by ?? "somebody"} pressed Play. Start it from Admin → Server and look at AMP for why` }
    : { ok: true, text: "The last wake worked, or none was asked for" };

  return { dump, dumpCopy, backup, pack, wake };
}

export type Alert = { check: CheckName; level: "ERROR" | "WARN"; message: string };

/** Pure: what to say when a round's answers differ from the last round's. Unknown (null) neither alerts nor clears. */
export function alerts(prev: Checks | null, next: Checks): Alert[] {
  const out: Alert[] = [];
  for (const name of Object.keys(next) as CheckName[]) {
    const was = prev?.[name].ok ?? true; // at the first round, what is wrong is news
    const is = next[name].ok;
    if (is === false && was !== false) out.push({ check: name, level: "ERROR", message: `Health: ${next[name].text}` });
    // a wake has no "well again": its failure simply stops being shown after ten minutes, which is not a wake
    if (name !== "wake" && is === true && prev?.[name].ok === false) out.push({ check: name, level: "WARN", message: `Health, well again: ${RECOVERED[name]}` });
  }
  return out;
}

const RECOVERED: Record<CheckName, string> = {
  dump: "there is a fresh database dump",
  dumpCopy: "the database dump is on the AMP host",
  backup: "there is a fresh world backup",
  pack: "the site and the server are on the same pack",
  wake: "the server woke",
};

/** One-word summary for /health: false when any check is wrong, true when none is (unknowns do not count). */
export const allWell = (c: Checks | null): boolean => !c || Object.values(c).every((x) => x.ok !== false);

type Deps = {
  amp: Amp;
  dumpsDir: string;
  repoDir: string;
  copied: () => { name: string; at: Date } | null;
  serverPack: () => Promise<string | null>;
  wake: () => { phase: string; by: string | null; endedAt: string | null };
  addEvent: (e: { at: Date; kind: "ERROR" | "WARN"; actor: null; message: string; meta: Record<string, unknown> }) => Promise<unknown>;
  log: (o: unknown, m: string) => void;
  now?: () => Date;
};

export class HealthWatch {
  checks: Checks | null = null;
  lookedAt: Date | null = null;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(private readonly d: Deps) {}

  start() {
    this.timer = setInterval(() => void this.round(), 10 * 60_000);
    setTimeout(() => void this.round(), 5 * 60_000).unref(); // after the dump copy's first try (two minutes)
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Sign-in outcomes from web, told at once (signin-watch.ts). */
  readonly signIns = new SignInWatch();

  async signInOutcome(method: SignInMethod, ok: boolean): Promise<void> {
    const now = (this.d.now ?? (() => new Date()))();
    const a = this.signIns.record(method, ok, now);
    if (!a) return;
    await this.d.addEvent({ at: now, kind: a.level, actor: null, message: a.message, meta: { health: "signin", method } }).catch((err) => this.d.log({ err: String(err) }, "health: could not write the event"));
    this.d.log({ check: "signin", method, level: a.level }, a.message);
  }

  /** A failed wake is told at once, not at the next ten-minute round. */
  async wakeFailed() {
    await this.round();
  }

  async gather(): Promise<Inputs> {
    let dump: Inputs["dump"];
    try {
      const name = newestDump(await readdir(this.d.dumpsDir));
      if (!name) dump = null;
      else {
        const s = await stat(path.join(this.d.dumpsDir, name));
        dump = { name, at: s.mtime, bytes: s.size };
      }
    } catch {
      dump = undefined;
    }
    const raw = await this.d.amp.call<unknown>("LocalFileBackupPlugin", "GetBackups").catch(() => undefined);
    const backups = Array.isArray(raw) ? datedBackups(raw) : undefined;
    const w = this.d.wake();
    return {
      dump,
      copied: this.d.copied(),
      backups,
      pack: { site: await sitePack(this.d.repoDir), server: await this.d.serverPack() },
      wake: { failed: w.phase === "failed", by: w.by, at: w.endedAt ? new Date(w.endedAt) : null },
    };
  }

  async round(): Promise<Checks | null> {
    if (this.busy) return this.checks;
    this.busy = true;
    try {
      const now = (this.d.now ?? (() => new Date()))();
      const next = evaluate(await this.gather(), now);
      for (const a of alerts(this.checks, next)) {
        await this.d.addEvent({ at: now, kind: a.level, actor: null, message: a.message, meta: { health: a.check } }).catch((err) => this.d.log({ err: String(err) }, "health: could not write the event"));
        this.d.log({ check: a.check, level: a.level }, a.message);
      }
      this.checks = next;
      this.lookedAt = now;
      return next;
    } catch (err) {
      this.d.log({ err: String(err) }, "health watch failed");
      return this.checks;
    } finally {
      this.busy = false;
    }
  }
}

/**
 * AMP's list as the watch needs it, newest first. Rows whose time cannot be read are left out; a list that has rows
 * but no readable time at all is "could not be looked at" (undefined), never "no backups".
 */
export function datedBackups(raw: unknown[]): Inputs["backups"] {
  const rows = readBackups(raw);
  const dated = rows.map((b) => ({ name: b.name, at: b.at ? new Date(b.at) : new Date(NaN), bytes: b.sizeBytes })).filter((b) => !Number.isNaN(b.at.getTime())).sort((a, b) => b.at.getTime() - a.at.getTime());
  return rows.length > 0 && dated.length === 0 ? undefined : dated;
}

/** The pack the site hands out: mods.json's version and the first eight of the lock's hash, as web builds it. */
export async function sitePack(repoDir: string): Promise<string | null> {
  try {
    const dir = path.join(repoDir, "modpack");
    const [m, lock] = await Promise.all([readFile(path.join(dir, "mods.json"), "utf8"), readFile(path.join(dir, "mods.lock.json"), "utf8")]);
    const version = (JSON.parse(m) as { version?: unknown }).version;
    const hash = (JSON.parse(lock) as { hash?: unknown }).hash;
    return typeof version === "string" && typeof hash === "string" && hash.length >= 8 ? `${version}+${hash.slice(0, 8)}` : null;
  } catch {
    return null;
  }
}
