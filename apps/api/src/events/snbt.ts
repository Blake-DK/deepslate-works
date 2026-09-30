import type { Nbt } from "../players/nbt.js";

// Minecraft's text form of NBT, as `data get entity` prints it: {Slot: 0b, id: "minecraft:stone", count: 64, ...}.
// Read into the same values as a save file (players/nbt.ts), so players/inventory.ts works on both.

export class SnbtError extends Error {}

const BARE = /[A-Za-z0-9._+-]/;

export function parseSnbt(text: string): Nbt {
  let i = 0;
  const s = text;
  const ws = () => { while (i < s.length && /\s/.test(s[i]!)) i++; };
  const fail = (what: string): never => { throw new SnbtError(`${what} at ${i}`); };
  const quoted = (): string => {
    const q = s[i++]!;
    let out = "";
    while (i < s.length && s[i] !== q) {
      if (s[i] === "\\") { i++; out += s[i++] ?? ""; } else out += s[i++];
    }
    if (s[i] !== q) fail("unclosed string");
    i++;
    return out;
  };
  const bare = (): string => { const st = i; while (i < s.length && BARE.test(s[i]!)) i++; if (i === st) fail("expected a value"); return s.slice(st, i); };
  const scalar = (word: string): Nbt => {
    if (word === "true") return 1;
    if (word === "false") return 0;
    const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)([bBsSlLfFdD]?)$/.exec(word);
    return m ? Number(m[1]) : word;
  };
  const value = (depth: number): Nbt => {
    if (depth > 64) fail("nested too deeply");
    ws();
    const c = s[i];
    if (c === "{") {
      i++;
      const o: { [k: string]: Nbt } = {};
      ws();
      if (s[i] === "}") { i++; return o; }
      for (;;) {
        ws();
        const key = s[i] === '"' || s[i] === "'" ? quoted() : bare();
        ws();
        if (s[i++] !== ":") fail("expected ':'");
        o[key] = value(depth + 1);
        ws();
        if (s[i] === ",") { i++; continue; }
        if (s[i] === "}") { i++; return o; }
        fail("expected ',' or '}'");
      }
    }
    if (c === "[") {
      i++;
      ws();
      // a typed array: [B; 1b, 2b], [I; 1, 2], [L; 1L]
      if (/[BIL]/.test(s[i] ?? "") && s[i + 1] === ";") i += 2;
      const a: Nbt[] = [];
      ws();
      if (s[i] === "]") { i++; return a; }
      for (;;) {
        a.push(value(depth + 1));
        ws();
        if (s[i] === ",") { i++; continue; }
        if (s[i] === "]") { i++; return a; }
        fail("expected ',' or ']'");
      }
    }
    if (c === '"' || c === "'") return quoted();
    return scalar(bare());
  };
  const v = value(0);
  ws();
  if (i !== s.length) fail("text after the value");
  return v;
}
