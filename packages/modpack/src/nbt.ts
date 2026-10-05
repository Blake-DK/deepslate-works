import { gunzipSync, gzipSync } from "node:zlib";

// Minecraft's NBT, read and written with every tag's type kept (a structure file is only valid when an int stays an
// int). For the builds an admin uploads (builds.ts): a WorldEdit .schem is read, a structure .nbt is written.

export type Tag =
  | { t: 1 | 2 | 3 | 5 | 6; v: number } // byte, short, int, float, double
  | { t: 4; v: bigint }
  | { t: 7; v: Buffer }
  | { t: 8; v: string }
  | { t: 9; e: number; v: Tag[] }
  | { t: 10; v: Record<string, Tag> }
  | { t: 11; v: number[] }
  | { t: 12; v: bigint[] };

export const byte = (v: number): Tag => ({ t: 1, v });
export const short = (v: number): Tag => ({ t: 2, v });
export const int = (v: number): Tag => ({ t: 3, v });
export const str = (v: string): Tag => ({ t: 8, v });
export const list = (e: number, v: Tag[]): Tag => ({ t: 9, e, v });
export const compound = (v: Record<string, Tag>): Tag => ({ t: 10, v });
export const ints = (v: number[]): Tag => list(3, v.map(int));

export class NbtError extends Error {}
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_DEPTH = 64;

/** Reads a (gzipped or plain) NBT file. The root is always a compound. */
export function readNbt(file: Buffer): Tag {
  let buf = file;
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      buf = gunzipSync(buf, { maxOutputLength: MAX_BYTES });
    } catch {
      throw new NbtError("the file is gzipped but does not unpack, or is larger than 64 MB unpacked");
    }
  }
  let at = 0;
  const need = (n: number) => {
    if (n < 0 || at + n > buf.length) throw new NbtError("the file ends in the middle of a tag");
  };
  const text = () => {
    need(2);
    const n = buf.readUInt16BE(at);
    at += 2;
    need(n);
    const s = buf.toString("utf8", at, at + n);
    at += n;
    return s;
  };
  const count = () => {
    need(4);
    const n = buf.readInt32BE(at);
    at += 4;
    if (n < 0 || n > buf.length) throw new NbtError("a list is longer than the file");
    return n;
  };
  const payload = (t: number, depth: number): Tag => {
    if (depth > MAX_DEPTH) throw new NbtError("tags are nested too deeply");
    switch (t) {
      case 1: need(1); return { t, v: buf.readInt8(at++) };
      case 2: need(2); at += 2; return { t, v: buf.readInt16BE(at - 2) };
      case 3: need(4); at += 4; return { t, v: buf.readInt32BE(at - 4) };
      case 4: need(8); at += 8; return { t, v: buf.readBigInt64BE(at - 8) };
      case 5: need(4); at += 4; return { t, v: buf.readFloatBE(at - 4) };
      case 6: need(8); at += 8; return { t, v: buf.readDoubleBE(at - 8) };
      case 7: { const n = count(); need(n); at += n; return { t, v: buf.subarray(at - n, at) }; }
      case 8: return { t, v: text() };
      case 9: {
        need(1);
        const e = buf.readUInt8(at++);
        const n = count();
        const v: Tag[] = [];
        for (let i = 0; i < n; i++) v.push(payload(e, depth + 1));
        return { t, e, v };
      }
      case 10: {
        const v: Record<string, Tag> = {};
        for (;;) {
          need(1);
          const kind = buf.readUInt8(at++);
          if (kind === 0) return { t, v };
          const name = text();
          v[name] = payload(kind, depth + 1);
        }
      }
      case 11: { const n = count(); need(n * 4); const v: number[] = []; for (let i = 0; i < n; i++, at += 4) v.push(buf.readInt32BE(at)); return { t, v }; }
      case 12: { const n = count(); need(n * 8); const v: bigint[] = []; for (let i = 0; i < n; i++, at += 8) v.push(buf.readBigInt64BE(at)); return { t, v }; }
      default: throw new NbtError(`unknown tag type ${t}`);
    }
  };
  need(1);
  if (buf.readUInt8(at++) !== 10) throw new NbtError("not an NBT file: it does not begin with a compound");
  text(); // the root's name, always empty in practice
  return payload(10, 0);
}

/** Writes a compound as a gzipped NBT file, the way the game writes structure files. */
export function writeNbt(root: Tag): Buffer {
  if (root.t !== 10) throw new NbtError("the root must be a compound");
  const parts: Buffer[] = [];
  const num = (bytes: number, put: (b: Buffer) => void) => { const b = Buffer.alloc(bytes); put(b); parts.push(b); };
  const text = (s: string) => { const b = Buffer.from(s, "utf8"); num(2, (x) => x.writeUInt16BE(b.length)); parts.push(b); };
  const payload = (x: Tag) => {
    switch (x.t) {
      case 1: num(1, (b) => b.writeInt8(x.v)); return;
      case 2: num(2, (b) => b.writeInt16BE(x.v)); return;
      case 3: num(4, (b) => b.writeInt32BE(x.v)); return;
      case 4: num(8, (b) => b.writeBigInt64BE(x.v)); return;
      case 5: num(4, (b) => b.writeFloatBE(x.v)); return;
      case 6: num(8, (b) => b.writeDoubleBE(x.v)); return;
      case 7: num(4, (b) => b.writeInt32BE(x.v.length)); parts.push(x.v); return;
      case 8: text(x.v); return;
      case 9: num(1, (b) => b.writeUInt8(x.v.length === 0 ? 0 : x.e)); num(4, (b) => b.writeInt32BE(x.v.length)); for (const i of x.v) payload(i); return;
      case 10:
        for (const [name, child] of Object.entries(x.v)) { num(1, (b) => b.writeUInt8(child.t)); text(name); payload(child); }
        num(1, (b) => b.writeUInt8(0));
        return;
      case 11: num(4, (b) => b.writeInt32BE(x.v.length)); for (const i of x.v) num(4, (b) => b.writeInt32BE(i)); return;
      case 12: num(4, (b) => b.writeInt32BE(x.v.length)); for (const i of x.v) num(8, (b) => b.writeBigInt64BE(i)); return;
    }
  };
  num(1, (b) => b.writeUInt8(10));
  text("");
  payload(root);
  return gzipSync(Buffer.concat(parts));
}

/** A child of a compound, when it is there and of that type. */
export function child<T extends Tag["t"]>(of: Tag | undefined, name: string, t: T): Extract<Tag, { t: T }> | undefined {
  const c = of && of.t === 10 ? of.v[name] : undefined;
  return c && c.t === t ? (c as Extract<Tag, { t: T }>) : undefined;
}
/** A whole number from a byte, short or int child. */
export function numberOf(of: Tag | undefined, name: string): number | undefined {
  const c = of && of.t === 10 ? of.v[name] : undefined;
  return c && (c.t === 1 || c.t === 2 || c.t === 3) ? c.v : undefined;
}
