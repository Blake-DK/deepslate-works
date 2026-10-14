import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

// Reads entries out of a zip (a mod's jar, Minecraft's client jar). Just enough for the item catalogue: the central
// directory, stored or deflated entries. No dependency for what node's zlib already does.

export type Zip = { names: string[]; read(name: string): Buffer | null; close?(): void };

export function openZip(buf: Buffer): Zip {
  // the end of central directory record is in the last 64 KB + 22 bytes
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, { method: number; size: number; local: number }>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("broken central directory");
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    entries.set(name, { method, size, local });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: [...entries.keys()],
    read(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (buf.readUInt32LE(e.local) !== 0x04034b50) return null;
      const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      const data = buf.subarray(start, start + e.size);
      if (e.method === 0) return Buffer.from(data);
      if (e.method === 8) return inflateRawSync(data);
      return null;
    },
  };
}

export async function openZipFile(file: string): Promise<Zip> {
  return openZip(await readFile(file));
}

/**
 * The same, read from the file as each entry is asked for: only the central directory is held in memory. For the item
 * catalogue, which keeps every server jar open at once (all of them in memory came to more than the test api's 384 MB
 * once Mekanism was in, 2026-10-12). `close()` when done.
 */
export function openZipOnDisk(file: string): Zip {
  const fd = openSync(file, "r");
  try {
    const at = (pos: number, len: number) => {
      const b = Buffer.alloc(len);
      const n = readSync(fd, b, 0, len, pos);
      return n === len ? b : b.subarray(0, n);
    };
    const size = fstatSync(fd).size;
    const tailLen = Math.min(size, 65_557);
    const tail = at(size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("not a zip file");
    const count = tail.readUInt16LE(eocd + 10);
    const dirSize = tail.readUInt32LE(eocd + 12);
    const dir = at(tail.readUInt32LE(eocd + 16), dirSize);
    const entries = new Map<string, { method: number; size: number; local: number }>();
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (dir.readUInt32LE(p) !== 0x02014b50) throw new Error("broken central directory");
      const method = dir.readUInt16LE(p + 10);
      const csize = dir.readUInt32LE(p + 20);
      const nameLen = dir.readUInt16LE(p + 28), extraLen = dir.readUInt16LE(p + 30), commentLen = dir.readUInt16LE(p + 32);
      entries.set(dir.toString("utf8", p + 46, p + 46 + nameLen), { method, size: csize, local: dir.readUInt32LE(p + 42) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    let open = true;
    return {
      names: [...entries.keys()],
      read(name) {
        const e = entries.get(name);
        if (!e || !open) return null;
        const head = at(e.local, 30);
        if (head.length < 30 || head.readUInt32LE(0) !== 0x04034b50) return null;
        const data = at(e.local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28), e.size);
        if (e.method === 0) return data;
        if (e.method === 8) return inflateRawSync(data);
        return null;
      },
      close() {
        if (open) closeSync(fd);
        open = false;
      },
    };
  } catch (err) {
    closeSync(fd);
    throw err;
  }
}
