import { gunzipSync } from "node:zlib";

// Minecraft's NBT, read only: what a player's save file (world/playerdata/<uuid>.dat, gzip) is made of.
// Longs come back as numbers (precision beyond 2^53 is lost; nothing in an inventory needs it).

export type Nbt = number | string | Nbt[] | { [key: string]: Nbt };

const MAX_DEPTH = 64;
const MAX_LEN = 1_000_000;

export class NbtError extends Error {}

class Reader {
  at = 0;
  constructor(private readonly b: Buffer) {}
  private need(n: number) {
    if (n < 0 || this.at + n > this.b.length) throw new NbtError(`the file ends early (at byte ${this.at})`);
  }
  u8() { this.need(1); return this.b.readUInt8(this.at++); }
  i8() { this.need(1); return this.b.readInt8(this.at++); }
  i16() { this.need(2); const v = this.b.readInt16BE(this.at); this.at += 2; return v; }
  u16() { this.need(2); const v = this.b.readUInt16BE(this.at); this.at += 2; return v; }
  i32() { this.need(4); const v = this.b.readInt32BE(this.at); this.at += 4; return v; }
  i64() { this.need(8); const v = Number(this.b.readBigInt64BE(this.at)); this.at += 8; return v; }
  f32() { this.need(4); const v = this.b.readFloatBE(this.at); this.at += 4; return v; }
  f64() { this.need(8); const v = this.b.readDoubleBE(this.at); this.at += 8; return v; }
  str() { const n = this.u16(); this.need(n); const v = this.b.toString("utf8", this.at, this.at + n); this.at += n; return v; }
  len() { const n = this.i32(); if (n < 0 || n > MAX_LEN) throw new NbtError(`a list of ${n} entries`); return n; }

  payload(type: number, depth: number): Nbt {
    if (depth > MAX_DEPTH) throw new NbtError("nested too deeply");
    switch (type) {
      case 1: return this.i8();
      case 2: return this.i16();
      case 3: return this.i32();
      case 4: return this.i64();
      case 5: return this.f32();
      case 6: return this.f64();
      case 7: { const n = this.len(); const a: number[] = []; for (let i = 0; i < n; i++) a.push(this.i8()); return a; }
      case 8: return this.str();
      case 9: {
        const inner = this.u8();
        const n = this.len();
        if (inner === 0 && n > 0) throw new NbtError("a list of nothing with entries");
        const a: Nbt[] = [];
        for (let i = 0; i < n; i++) a.push(this.payload(inner, depth + 1));
        return a;
      }
      case 10: {
        const o: { [key: string]: Nbt } = {};
        for (;;) {
          const t = this.u8();
          if (t === 0) return o;
          const name = this.str();
          o[name] = this.payload(t, depth + 1);
        }
      }
      case 11: { const n = this.len(); const a: number[] = []; for (let i = 0; i < n; i++) a.push(this.i32()); return a; }
      case 12: { const n = this.len(); const a: number[] = []; for (let i = 0; i < n; i++) a.push(this.i64()); return a; }
      default: throw new NbtError(`unknown tag type ${type} at byte ${this.at}`);
    }
  }
}

/** The root compound of an NBT file, gzip or not. */
export function readNbt(file: Buffer): { [key: string]: Nbt } {
  const raw = file.length >= 2 && file[0] === 0x1f && file[1] === 0x8b ? gunzipSync(file, { maxOutputLength: 16 * 1024 * 1024 }) : file;
  const r = new Reader(raw);
  const type = r.u8();
  if (type !== 10) throw new NbtError(`the file does not start with a compound (tag ${type})`);
  r.str();
  const root = r.payload(10, 0);
  return root as { [key: string]: Nbt };
}
