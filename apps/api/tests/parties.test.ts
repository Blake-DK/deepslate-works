import { describe, expect, it } from "vitest";
import { partyName, PartyBook, readParty, uuidFromInts } from "../src/players/parties.js";
import type { Amp } from "../src/amp/client.js";

// Open Parties and Claims 0.31.6 party files (PartyNbtSerializer / PartyMemberNbtSerializer): what the player page shows.

// c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10 as NbtUtils.createUUID writes it: four signed ints
const ALEX = [0xc50f3e2a | 0, 0x7d414b8e | 0, 0x9a632e1d | 0, 0x4f6b8c10 | 0];
const ROWAN = [0x11111111, 0x2222_4222, 0x83333333 | 0, 0x44444444];

const file = (owner: number[], members: number[][], allies: number[][] = []) => ({
  owner: { uuid: owner, username: "Bramble09", rank: "ADMIN" },
  members: members.map((m) => ({ uuid: m, username: "samoyedx", rank: "MEMBER" })),
  invites: [],
  allies,
  confirmedActivity: 0,
});

describe("party files", () => {
  it("turns OPAC's int-array UUIDs back into the usual form", () => {
    expect(uuidFromInts(ALEX)).toBe("c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10");
    expect(uuidFromInts([1, 2, 3])).toBeNull();
    expect(uuidFromInts("x")).toBeNull();
  });
  it("reads the owner first, then the members, and the allied parties", () => {
    const p = readParty("p1", file(ALEX, [ROWAN], [ROWAN]));
    expect(p?.members.map((m) => [m.name, m.owner])).toEqual([["Bramble09", true], ["samoyedx", false]]);
    expect(p?.allies).toEqual([uuidFromInts(ROWAN)]);
    expect(readParty("p1", { members: [] })).toBeNull();
  });
  it("finds the party's name in the owner's player config", () => {
    expect(partyName('[playerConfig]\n\t[playerConfig.parties]\n\t\tname = "The \\"Deep\\" Crew"\n\t[playerConfig.claims]\n\t\tname = "Base"\n')).toBe('The "Deep" Crew');
    expect(partyName('[playerConfig.claims]\nname = "Base"\n')).toBeNull();
    expect(partyName('[playerConfig.parties]\nname = ""\n')).toBeNull();
  });
});

describe("the party book", () => {
  it("finds a player's party through AMP's file manager and has no party for others", async () => {
    // the NBT of one party file, written by hand: an unnamed root compound
    const nbt = encode(file(ALEX, [ROWAN]));
    const toml = Buffer.from('[playerConfig.parties]\nname = "Deepslate Crew"\n');
    const amp: Amp = {
      async ping() {},
      async getStatus() { return { state: "Running", stateCode: 20, players: [], maxPlayers: 20, cpu: 0, memMb: 0, memMaxMb: 0, tps: 20, uptime: "0" }; },
      async call<T>(_m: string, method: string, p: Record<string, unknown> = {}): Promise<T> {
        if (method === "GetDirectoryListing") {
          if (String(p.Dir).endsWith("/parties")) return [{ Filename: "0f0e0d0c-0000-4000-8000-000000000001.nbt", SizeBytes: nbt.length }] as T;
          return [{ Filename: "c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10.toml", SizeBytes: toml.length }] as T;
        }
        if (method === "GetFileChunk") return { Base64Data: (String(p.Filename).endsWith(".nbt") ? nbt : toml).toString("base64") } as T;
        return null as T;
      },
    };
    const book = new PartyBook(amp);
    const v = await book.forPlayer(uuidFromInts(ROWAN)!.toUpperCase());
    expect(v?.name).toBe("Deepslate Crew");
    expect(v?.members.map((m) => m.name)).toEqual(["Bramble09", "samoyedx"]);
    expect(await book.forPlayer("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

// A small NBT writer for the test: compounds, lists of compounds or int arrays, strings, int arrays, longs.
function encode(root: Record<string, unknown>): Buffer {
  const out: Buffer[] = [];
  const str = (s: string) => { const b = Buffer.from(s, "utf8"); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); out.push(l, b); };
  const tagOf = (v: unknown): number => (typeof v === "string" ? 8 : typeof v === "number" ? 4 : Array.isArray(v) ? (v.length && typeof v[0] === "number" ? 11 : 9) : 10);
  const payload = (t: number, v: unknown) => {
    if (t === 8) str(v as string);
    else if (t === 4) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v as number)); out.push(b); }
    else if (t === 11) { const a = v as number[]; const b = Buffer.alloc(4 + 4 * a.length); b.writeInt32BE(a.length); a.forEach((n, i) => b.writeInt32BE(n, 4 + 4 * i)); out.push(b); }
    else if (t === 9) { const a = v as unknown[]; const et = a.length ? tagOf(a[0]) : 0; const h = Buffer.alloc(5); h.writeUInt8(et); h.writeInt32BE(a.length, 1); out.push(h); for (const e of a) payload(et, e); }
    else { for (const [k, e] of Object.entries(v as Record<string, unknown>)) { const et = tagOf(e); out.push(Buffer.from([et])); str(k); payload(et, e); } out.push(Buffer.from([0])); }
  };
  out.push(Buffer.from([10])); str(""); payload(10, root);
  return Buffer.concat(out);
}
