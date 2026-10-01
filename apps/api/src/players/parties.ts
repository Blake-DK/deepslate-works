import type { Amp } from "../amp/client.js";
import { chunks } from "../files/browse.js";
import { readNbt, type Nbt } from "./nbt.js";

// Open Parties and Claims (planner, 2026-10-01): a player's party on their page, read only. OPAC keeps each party in
// <world>/data/openpartiesandclaims/parties/<partyId>.nbt, uncompressed NBT: owner {uuid, username, rank}, members
// [same, without the owner], invites, allies [party ids], confirmedActivity (PartyNbtSerializer, 0.31.6). UUIDs are
// int arrays of four. The party's name is the owner's player option parties.name, in
// player-configs/<ownerUuid>.toml. No OPAC party command answers from the console, hence the files.

export const OPAC_DIR = "world/data/openpartiesandclaims";
const MOST_PARTIES = 300;
const MAX_FILE = 256 * 1024;
const FRESH_MS = 60_000;

export type Member = { uuid: string; name: string; rank: string; owner: boolean };
export type Party = { id: string; members: Member[]; allies: string[] };
export type PartyView = { id: string; name: string | null; members: Member[]; allies: Array<{ id: string; name: string | null; owner: string | null }> };
type AmpEntry = { IsDirectory?: boolean; Filename?: string; SizeBytes?: number };

/** Pure: four signed 32-bit ints, most significant first (NbtUtils.createUUID), as a dashed UUID. */
export function uuidFromInts(v: Nbt | undefined): string | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === "number")) return null;
  const hex = (v as number[]).map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function member(v: Nbt | undefined, owner: boolean): Member | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const uuid = uuidFromInts(v.uuid);
  const name = typeof v.username === "string" ? v.username : "";
  return uuid ? { uuid, name, rank: typeof v.rank === "string" ? v.rank : "MEMBER", owner } : null;
}

/** Pure: one party file, as OPAC wrote it. Null when it is not one. */
export function readParty(id: string, data: { [key: string]: Nbt }): Party | null {
  const owner = member(data.owner, true);
  if (!owner) return null;
  const others = Array.isArray(data.members) ? data.members.map((m) => member(m, false)).filter((m): m is Member => m !== null) : [];
  const allies = Array.isArray(data.allies) ? data.allies.map((a) => uuidFromInts(a)).filter((a): a is string => a !== null) : [];
  return { id, members: [owner, ...others], allies };
}

/** Pure: parties.name out of a player's OPAC config (TOML, `[playerConfig.parties]` … `name = "…"`). */
export function partyName(toml: string): string | null {
  let inParties = false;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) {
      inParties = section[1]!.trim() === "playerConfig.parties";
      continue;
    }
    const m = inParties ? /^name\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(line) : null;
    if (m) return m[1]!.replace(/\\(.)/g, "$1").trim().slice(0, 64) || null;
  }
  return null;
}

/** All parties, read through AMP's file manager (the same read-only calls as Admin → Files), kept for a minute. */
export class PartyBook {
  private cache: { at: number; parties: Party[] } | null = null;
  private names = new Map<string, { at: number; name: string | null }>();

  constructor(
    private readonly amp: Amp,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async read(path: string, size: number): Promise<Buffer> {
    const parts: Buffer[] = [];
    for await (const c of chunks(this.amp, path, size, MAX_FILE)) parts.push(c);
    return Buffer.concat(parts);
  }

  async all(): Promise<Party[]> {
    if (this.cache && this.now() - this.cache.at < FRESH_MS) return this.cache.parties;
    const dir = `${OPAC_DIR}/parties`;
    const listing = await this.amp.call<AmpEntry[] | { Title?: string }>("FileManagerPlugin", "GetDirectoryListing", { Dir: dir }).catch(() => null);
    // no folder yet: OPAC has not run, or nobody has made a party
    const files = Array.isArray(listing) ? listing.filter((e) => !e.IsDirectory && /^[0-9a-f-]{36}\.nbt$/i.test(e.Filename ?? "")).slice(0, MOST_PARTIES) : [];
    const parties: Party[] = [];
    for (const f of files) {
      const size = Math.max(0, Number(f.SizeBytes) || 0);
      if (size === 0 || size > MAX_FILE) continue;
      try {
        const p = readParty(f.Filename!.slice(0, 36).toLowerCase(), readNbt(await this.read(`${dir}/${f.Filename}`, size)));
        if (p) parties.push(p);
      } catch {
        /* a file being written, or not a party: skipped */
      }
    }
    this.cache = { at: this.now(), parties };
    return parties;
  }

  private async nameOf(owner: string): Promise<string | null> {
    const known = this.names.get(owner);
    if (known && this.now() - known.at < FRESH_MS) return known.name;
    const dir = `${OPAC_DIR}/player-configs`;
    let name: string | null = null;
    try {
      const listing = await this.amp.call<AmpEntry[]>("FileManagerPlugin", "GetDirectoryListing", { Dir: dir });
      const f = Array.isArray(listing) ? listing.find((e) => e.Filename === `${owner}.toml` && !e.IsDirectory) : undefined;
      const size = Math.max(0, Number(f?.SizeBytes) || 0);
      if (f && size > 0 && size <= MAX_FILE) name = partyName((await this.read(`${dir}/${owner}.toml`, size)).toString("utf8"));
    } catch {
      name = null;
    }
    this.names.set(owner, { at: this.now(), name });
    return name;
  }

  /** The party `uuid` is in, with its members and allies, or null. */
  async forPlayer(uuid: string): Promise<PartyView | null> {
    const id = uuid.toLowerCase();
    const parties = await this.all();
    const p = parties.find((x) => x.members.some((m) => m.uuid === id));
    if (!p) return null;
    const ownerOf = (party: Party) => party.members.find((m) => m.owner) ?? null;
    const allies = await Promise.all(
      p.allies.map(async (a) => {
        const ally = parties.find((x) => x.id === a);
        const o = ally ? ownerOf(ally) : null;
        return { id: a, name: o ? await this.nameOf(o.uuid) : null, owner: o?.name ?? null };
      }),
    );
    const o = ownerOf(p);
    return { id: p.id, name: o ? await this.nameOf(o.uuid) : null, members: p.members, allies };
  }
}
