import type { Amp } from "../amp/client.js";
import { isDenied } from "../shared/settings.js";
import { cleanPath, isTextLike, nameOf, parentOf } from "./paths.js";

// Read-only: only GetDirectoryListing and GetFileChunk are ever called. There is no code path here that
// writes, renames or deletes, and none will be added: configs are edited in the repo and shipped by Sync.

export type Entry = { name: string; path: string; dir: boolean; size: number; modified: string | null; denied: boolean; text: boolean };
type AmpEntry = { IsDirectory?: boolean; Filename?: string; SizeBytes?: number; Modified?: string; Created?: string };
type AmpError = { Title?: string; Message?: string };

export class FileError extends Error {
  constructor(public readonly code: "validation" | "forbidden" | "not_found" | "too_large" | "amp_error", message: string, public readonly status: number) {
    super(message);
  }
}

const isAmpError = (v: unknown): v is AmpError => Boolean(v) && typeof v === "object" && !Array.isArray(v) && typeof (v as AmpError).Title === "string" && "Message" in (v as object);

/** `_backup/db` and everything under it, whatever the case or the slashes. */
export function isDbDumps(path: string): boolean {
  return /^_backup\/db(\/|$)/i.test(path.replace(/\\/g, "/").replace(/^\/+/, ""));
}

function checked(input: unknown, denied: readonly string[]): string {
  const c = cleanPath(input);
  if (!c.ok) throw new FileError("validation", c.reason, 400);
  // docs/28 §4.7: the database dumps that ride along in the world backup are refused in code, because a saved
  // denied list does not pick up a new default.
  if (isDbDumps(c.path)) throw new FileError("forbidden", `"${c.path}" holds the portal's database dumps and is never shown or downloaded here.`, 403);
  if (isDenied(c.path, denied)) throw new FileError("forbidden", `"${c.path}" is on the list of files the portal never shows or downloads (worlds, player data, backups, keys). Use AMP for those.`, 403);
  return c.path;
}

export async function list(amp: Amp, dir: unknown, denied: readonly string[]): Promise<{ path: string; entries: Entry[] }> {
  const path = checked(dir, denied);
  const r = await amp.call<AmpEntry[] | AmpError>("FileManagerPlugin", "GetDirectoryListing", { Dir: path });
  if (isAmpError(r)) throw new FileError(/not found|does not exist/i.test(`${r.Title} ${r.Message}`) ? "not_found" : "amp_error", r.Message ?? r.Title ?? "AMP refused", /not found|does not exist/i.test(`${r.Title} ${r.Message}`) ? 404 : 502);
  if (!Array.isArray(r)) throw new FileError("amp_error", "AMP answered with something that is not a folder listing", 502);
  const entries = r
    .filter((e): e is AmpEntry & { Filename: string } => typeof e.Filename === "string" && e.Filename !== "" && !e.Filename.includes("/") && e.Filename !== "..")
    .map((e): Entry => {
      const p = path ? `${path}/${e.Filename}` : e.Filename;
      const dirEntry = Boolean(e.IsDirectory);
      return { name: e.Filename, path: p, dir: dirEntry, size: dirEntry ? 0 : Math.max(0, Number(e.SizeBytes) || 0), modified: e.Modified ?? e.Created ?? null, denied: isDbDumps(p) || isDenied(dirEntry ? `${p}/` : p, denied) || isDenied(p, denied), text: !dirEntry && isTextLike(e.Filename) };
    })
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return { path, entries };
}

/** The entry for one file, from its folder's listing: that is where the size comes from. */
export async function stat(amp: Amp, file: unknown, denied: readonly string[]): Promise<Entry> {
  const path = checked(file, denied);
  if (!path) throw new FileError("validation", "Pick a file.", 400);
  const parent = await list(amp, parentOf(path), denied);
  const entry = parent.entries.find((e) => e.name === nameOf(path));
  if (!entry) throw new FileError("not_found", `There is no "${path}" on the server.`, 404);
  if (entry.dir) throw new FileError("validation", `"${path}" is a folder.`, 400);
  return entry;
}

const CHUNK = 512 * 1024;

/** The file's bytes in order, at most `limit` of them. */
export async function* chunks(amp: Amp, path: string, size: number, limit: number): AsyncGenerator<Buffer> {
  const end = Math.min(size, limit);
  for (let at = 0; at < end; ) {
    const want = Math.min(CHUNK, end - at);
    const r = await amp.call<{ Base64Data?: string; BytesLength?: number } | AmpError>("FileManagerPlugin", "GetFileChunk", { Filename: path, Position: at, Length: want });
    if (isAmpError(r)) throw new FileError("amp_error", r.Message ?? r.Title ?? "AMP refused", 502);
    const buf = Buffer.from(r.Base64Data ?? "", "base64");
    if (buf.length === 0) return; // the file shrank while we were reading
    yield buf.length > want ? buf.subarray(0, want) : buf;
    at += buf.length;
  }
}

export type Preview = { entry: Entry; text: string; truncated: boolean; shown: number };

export async function preview(amp: Amp, file: unknown, denied: readonly string[], maxBytes: number): Promise<Preview> {
  const entry = await stat(amp, file, denied);
  if (!entry.text) throw new FileError("validation", `"${entry.name}" is not a text file. Download it instead.`, 415);
  const parts: Buffer[] = [];
  for await (const c of chunks(amp, entry.path, entry.size, maxBytes)) parts.push(c);
  const buf = Buffer.concat(parts);
  // binary that happens to have a text extension
  if (buf.subarray(0, 8000).includes(0)) throw new FileError("validation", `"${entry.name}" does not look like text. Download it instead.`, 415);
  return { entry, text: buf.toString("utf8"), truncated: entry.size > buf.length, shown: buf.length };
}
