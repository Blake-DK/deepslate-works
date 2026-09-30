import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

// Reads entries out of a zip (a mod's jar, Minecraft's client jar). Just enough for the item catalogue: the central
// directory, stored or deflated entries. No dependency for what node's zlib already does.

export type Zip = { names: string[]; read(name: string): Buffer | null };

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
