import path from "node:path";
import { sha512File } from "./download";
import { shippedFiles, type LockFile } from "./lock";
import { privateJarOf } from "./mod-url";
import { openZip, openZipOnDisk, type Zip } from "./zip";

// Do the pack's mods fit together, by what each jar says it needs (META-INF/neoforge.mods.toml), jar-in-jar libraries
// included? Twice a pack passed Lock and every PC then refused to start: Xaero's maps 26.6.0 / 1.47.0 wanted Open
// Parties and Claims 0.32.4 while it was pinned at 0.31.6 (2026-10-05), and Create Aeronautics wanted Flywheel 1.0.6
// while Vanillin's own Flywheel 1.0.4 is the one PCs loaded (2026-10-20). Lock refuses such a pack; `modpack lint` and
// `modpack check-deps` say the same of the lock as committed.

// ---- Versions and ranges, as NeoForge compares them (Maven's ComparableVersion and VersionRange) ----

type Item = { kind: "int"; value: bigint } | { kind: "str"; value: string } | { kind: "list"; items: Item[] };

const QUALIFIERS = ["alpha", "beta", "milestone", "rc", "snapshot", "", "sp"];
const ALIASES = new Map([["ga", ""], ["final", ""], ["release", ""], ["cr", "rc"]]);
const RELEASE = String(QUALIFIERS.indexOf(""));
const SHORT = new Map([["a", "alpha"], ["b", "beta"], ["m", "milestone"]]);
const qualifier = (q: string) => {
  const i = QUALIFIERS.indexOf(q);
  return i < 0 ? `${QUALIFIERS.length}-${q}` : String(i);
};
const cmp = <T extends string | bigint>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);

function strItem(value: string, followedByDigit: boolean): Item {
  const v = followedByDigit && value.length === 1 ? (SHORT.get(value) ?? value) : value;
  return { kind: "str", value: ALIASES.get(v) ?? v };
}
const numOrStr = (isDigit: boolean, s: string): Item => (isDigit ? { kind: "int", value: BigInt(s) } : strItem(s, false));
const isNull = (i: Item) => (i.kind === "int" ? i.value === 0n : i.kind === "str" ? qualifier(i.value) === RELEASE : i.items.length === 0);

function compareItem(a: Item, b: Item | null): number {
  if (a.kind === "int") {
    if (!b) return a.value === 0n ? 0 : 1;
    return b.kind === "int" ? cmp(a.value, b.value) : 1;
  }
  if (a.kind === "str") {
    if (!b) return cmp(qualifier(a.value), RELEASE);
    return b.kind === "str" ? cmp(qualifier(a.value), qualifier(b.value)) : -1;
  }
  if (!b) return a.items.length === 0 ? 0 : compareItem(a.items[0]!, null);
  if (b.kind === "int") return -1;
  if (b.kind === "str") return 1;
  for (let n = 0; n < Math.max(a.items.length, b.items.length); n++) {
    const l = a.items[n] ?? null;
    const r = b.items[n] ?? null;
    const c = l ? compareItem(l, r) : r ? -compareItem(r, null) : 0;
    if (c !== 0) return c;
  }
  return 0;
}

function parseVersion(version: string): Item {
  const v = version.toLowerCase();
  const root: Item = { kind: "list", items: [] };
  let list = root;
  const stack = [root];
  const sub = () => {
    const next: Item & { kind: "list" } = { kind: "list", items: [] };
    list.items.push(next);
    list = next;
    stack.push(next);
  };
  let isDigit = false;
  let start = 0;
  for (let i = 0; i < v.length; i++) {
    const c = v[i]!;
    if (c === "." || c === "-") {
      list.items.push(i === start ? { kind: "int", value: 0n } : numOrStr(isDigit, v.slice(start, i)));
      start = i + 1;
      if (c === "-") sub();
    } else if (c >= "0" && c <= "9") {
      if (!isDigit && i > start) {
        list.items.push(strItem(v.slice(start, i), true));
        start = i;
        sub();
      }
      isDigit = true;
    } else {
      if (isDigit && i > start) {
        list.items.push(numOrStr(true, v.slice(start, i)));
        start = i;
        sub();
      }
      isDigit = false;
    }
  }
  if (v.length > start) list.items.push(numOrStr(isDigit, v.slice(start)));
  for (const l of stack.reverse()) {
    if (l.kind !== "list") continue;
    for (let n = l.items.length - 1; n >= 0; n--) {
      const last = l.items[n]!;
      if (isNull(last)) l.items.splice(n, 1);
      else if (last.kind !== "list") break;
    }
  }
  return root;
}

/** Maven's order of two versions (what NeoForge uses): `1.0.6` > `1.0.4`, `1.0` = `1.0.0`, `1.0-beta` < `1.0`. */
export function compareVersions(a: string, b: string): number {
  return compareItem(parseVersion(a), parseVersion(b));
}

type Bound = { v: string; inclusive: boolean } | null;
/** A dependency's versionRange; `sets` null is any version ("", "*", or a bare version, which Maven reads as a wish). */
export type VersionRange = { spec: string; sets: Array<{ lower: Bound; upper: Bound }> | null };

/** Maven range syntax, as NeoForge reads it: `[1.0.6,2.0)`, `[21.1.228,)`, `[1.21.1]`, `(,0.8.12)`, `[1,2),[3,4)`. */
export function parseRange(spec: string): VersionRange {
  let rest = spec.trim();
  if (!rest.startsWith("[") && !rest.startsWith("(")) return { spec, sets: null };
  const sets: Array<{ lower: Bound; upper: Bound }> = [];
  while (rest.startsWith("[") || rest.startsWith("(")) {
    const close = [rest.indexOf(")"), rest.indexOf("]")].filter((n) => n >= 0);
    if (!close.length) throw new Error(`unbounded range "${spec}"`);
    const end = Math.min(...close);
    const lowerIncl = rest.startsWith("[");
    const upperIncl = rest[end] === "]";
    const inner = rest.slice(1, end).trim();
    const comma = inner.indexOf(",");
    let set: { lower: Bound; upper: Bound };
    if (comma < 0) {
      if (!lowerIncl || !upperIncl || !inner) throw new Error(`a single version must be in [ ]: "${spec}"`);
      set = { lower: { v: inner, inclusive: true }, upper: { v: inner, inclusive: true } };
    } else {
      const lo = inner.slice(0, comma).trim();
      const hi = inner.slice(comma + 1).trim();
      if (lo === hi) throw new Error(`a range cannot have the same version at both ends: "${spec}"`);
      if (lo && hi && compareVersions(hi, lo) < 0) throw new Error(`a range whose end comes before its start: "${spec}"`);
      set = { lower: lo ? { v: lo, inclusive: lowerIncl } : null, upper: hi ? { v: hi, inclusive: upperIncl } : null };
    }
    const prev = sets.at(-1)?.upper;
    if (prev && (!set.lower || compareVersions(set.lower.v, prev.v) < 0)) throw new Error(`ranges that overlap: "${spec}"`);
    sets.push(set);
    rest = rest.slice(end + 1).trim();
    if (rest.startsWith(",")) rest = rest.slice(1).trim();
  }
  if (rest) throw new Error(`text after the range: "${spec}"`);
  return { spec, sets };
}

export function inRange(range: VersionRange, version: string): boolean {
  if (!range.sets) return true;
  return range.sets.some(({ lower, upper }) => {
    if (lower) {
      const c = compareVersions(lower.v, version);
      if (c > 0 || (c === 0 && !lower.inclusive)) return false;
    }
    if (upper) {
      const c = compareVersions(upper.v, version);
      if (c < 0 || (c === 0 && !upper.inclusive)) return false;
    }
    return true;
  });
}

// ---- neoforge.mods.toml: as much TOML as mods.toml files use ----

type TomlTable = { header: string[]; array: boolean; values: Map<string, unknown> };
const ESCAPES: Record<string, string> = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };

/** The tables of a TOML file in order, with their keys. Arrays and inline tables are read past, not kept apart. */
export function readToml(text: string): TomlTable[] {
  const s = text.replace(/\r\n?/g, "\n");
  const tables: TomlTable[] = [{ header: [], array: false, values: new Map() }];
  let i = 0;
  const fail = (what: string) => new Error(`${what} on line ${s.slice(0, i).split("\n").length}`);
  const ws = () => {
    while (s[i] === " " || s[i] === "\t") i++;
  };
  const comment = () => {
    if (s[i] === "#") while (i < s.length && s[i] !== "\n") i++;
  };
  const blank = () => {
    for (;;) {
      ws();
      comment();
      if (s[i] !== "\n") return;
      i++;
    }
  };
  const unescape = (raw: string) =>
    raw.replace(/\\(?:([btnfr"\\])|u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|[ \t]*\n\s*)/g, (_m, e: string | undefined, u: string | undefined, U: string | undefined) =>
      e ? ESCAPES[e]! : u || U ? String.fromCodePoint(parseInt((u ?? U)!, 16)) : "");
  const str = (): string => {
    const q = s[i]!;
    if (s.startsWith(q.repeat(3), i)) {
      i += 3;
      if (s[i] === "\n") i++;
      const end = s.indexOf(q.repeat(3), i);
      if (end < 0) throw fail("a string that never ends");
      let raw = s.slice(i, end);
      i = end + 3;
      for (let extra = 0; extra < 2 && s[i] === q; extra++, i++) raw += q;
      return q === '"' ? unescape(raw) : raw;
    }
    i++;
    let raw = "";
    while (i < s.length && s[i] !== q && s[i] !== "\n") {
      if (q === '"' && s[i] === "\\") raw += s[i++];
      raw += s[i++];
    }
    if (s[i] !== q) throw fail("a string that never ends");
    i++;
    return q === '"' ? unescape(raw) : raw;
  };
  const BARE = /[A-Za-z0-9_-]+/y;
  const key = (): string[] => {
    const parts: string[] = [];
    for (;;) {
      ws();
      if (s[i] === '"' || s[i] === "'") parts.push(str());
      else {
        BARE.lastIndex = i;
        const m = BARE.exec(s);
        if (!m) throw fail("a key was expected");
        parts.push(m[0]);
        i += m[0].length;
      }
      ws();
      if (s[i] !== ".") return parts;
      i++;
    }
  };
  const TOKEN = /[^\s,\]}#]+/y;
  const value = (): unknown => {
    const c = s[i];
    if (c === '"' || c === "'") return str();
    if (c === "[") {
      i++;
      const out: unknown[] = [];
      for (;;) {
        blank();
        if (s[i] === "]") {
          i++;
          return out;
        }
        out.push(value());
        blank();
        if (s[i] === ",") i++;
        else if (s[i] !== "]") throw fail("an array that never ends");
      }
    }
    if (c === "{") {
      i++;
      const out = new Map<string, unknown>();
      for (;;) {
        blank();
        if (s[i] === "}") {
          i++;
          return out;
        }
        const k = key();
        if (s[i++] !== "=") throw fail("= was expected");
        ws();
        out.set(k.join("."), value());
        blank();
        if (s[i] === ",") i++;
        else if (s[i] !== "}") throw fail("an inline table that never ends");
      }
    }
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(s);
    if (!m) throw fail("a value was expected");
    i += m[0].length;
    return m[0] === "true" ? true : m[0] === "false" ? false : m[0];
  };
  for (;;) {
    blank();
    if (i >= s.length) return tables;
    if (s[i] === "[") {
      const array = s[i + 1] === "[";
      i += array ? 2 : 1;
      const header = key();
      if (s[i] !== "]" || (array && s[i + 1] !== "]")) throw fail("a table header that never ends");
      i += array ? 2 : 1;
      tables.push({ header, array, values: new Map() });
    } else {
      const k = key();
      if (s[i++] !== "=") throw fail("= was expected");
      ws();
      tables.at(-1)!.values.set(k.join("."), value());
    }
    ws();
    comment();
    if (i < s.length && s[i] !== "\n") throw fail("text after a value");
  }
}

export type DepType = "required" | "optional" | "incompatible" | "discouraged";
export type DepSide = "BOTH" | "CLIENT" | "SERVER";
export type ModDep = { modId: string; type: DepType; range: string; side: DepSide };
/** One [[mods]] entry; `version` null when it is filled in at build time and the jar does not say. */
export type ModDecl = { modId: string; version: string | null; deps: ModDep[] };

const TYPES = new Set<string>(["required", "optional", "incompatible", "discouraged"]);
const text = (v: unknown) => (typeof v === "string" ? v : undefined);

/**
 * The mods a neoforge.mods.toml declares and what each needs. `type` defaults to required; older files say
 * `mandatory = true/false` instead. Dependencies under a mod id that is not one of the file's mods are not read,
 * as NeoForge does not read them (Xaero's Minimap carries a block for xaerobetterpvp).
 */
export function readModsToml(toml: string, jarVersion: string | null = null): ModDecl[] {
  const tables = readToml(toml);
  const mods: ModDecl[] = [];
  for (const t of tables) {
    if (!t.array || t.header.length !== 1 || t.header[0] !== "mods") continue;
    const modId = text(t.values.get("modId"));
    if (!modId) continue;
    let version: string | null = text(t.values.get("version")) ?? "1";
    if (version.includes("${file.jarVersion}")) version = jarVersion ? version.replaceAll("${file.jarVersion}", jarVersion) : null;
    if (version?.includes("${")) version = null;
    mods.push({ modId, version, deps: [] });
  }
  const byId = new Map(mods.map((m) => [m.modId, m]));
  for (const t of tables) {
    if (!t.array || t.header.length !== 2 || t.header[0] !== "dependencies") continue;
    const owner = byId.get(t.header[1]!);
    const modId = text(t.values.get("modId"));
    if (!owner || !modId) continue;
    const type = text(t.values.get("type"))?.toLowerCase();
    const mandatory = t.values.get("mandatory");
    const side = text(t.values.get("side"))?.toUpperCase();
    owner.deps.push({
      modId,
      type: type && TYPES.has(type) ? (type as DepType) : mandatory === false ? "optional" : "required",
      range: text(t.values.get("versionRange")) ?? "",
      side: side === "CLIENT" || side === "SERVER" ? side : "BOTH",
    });
  }
  return mods;
}

// ---- Jars ----

/** A jar-in-jar library a jar carries (META-INF/jarjar/metadata.json), with what it declares in turn. */
export type Nested = { id: string; range: string; version: string; path: string; jar: JarMods };
/** What a jar declares: its mods, its jar-in-jar libraries, and what could not be read (said, not fatal). */
export type JarMods = { mods: ModDecl[]; nested: Nested[]; notes: string[] };

type JarJarMeta = { jars?: Array<{ identifier?: { group?: string; artifact?: string }; version?: { range?: string; artifactVersion?: string }; path?: string }> };

/** Reads a jar's neoforge.mods.toml and its jar-in-jar libraries' (their metadata.json, then each nested jar, down to three deep). */
export function jarMods(zip: Zip, depth = 0): JarMods {
  const out: JarMods = { mods: [], nested: [], notes: [] };
  const manifest = zip.read("META-INF/MANIFEST.MF")?.toString("utf8");
  const implVersion = manifest?.match(/^Implementation-Version:\s*(\S+)/m)?.[1] ?? null;
  const toml = zip.read("META-INF/neoforge.mods.toml")?.toString("utf8");
  if (toml) {
    try {
      out.mods = readModsToml(toml, implVersion);
    } catch (e) {
      out.notes.push(`its neoforge.mods.toml could not be read (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  const meta = zip.read("META-INF/jarjar/metadata.json")?.toString("utf8");
  if (!meta || depth >= 3) return out;
  let list: JarJarMeta["jars"];
  try {
    list = (JSON.parse(meta) as JarJarMeta).jars ?? [];
  } catch {
    out.notes.push("its META-INF/jarjar/metadata.json could not be read");
    return out;
  }
  for (const e of list) {
    if (!e.path || !e.identifier?.group || !e.identifier.artifact) continue;
    const inner = zip.read(e.path);
    if (!inner) {
      out.notes.push(`its jar-in-jar ${e.path} is listed but not in the jar`);
      continue;
    }
    let jar: JarMods;
    try {
      jar = jarMods(openZip(inner), depth + 1);
    } catch (err) {
      jar = { mods: [], nested: [], notes: [`${err instanceof Error ? err.message : String(err)}`] };
    }
    const name = path.posix.basename(e.path);
    out.notes.push(...jar.notes.map((n) => `${name}: ${n}`));
    out.nested.push({ id: `${e.identifier.group}:${e.identifier.artifact}`, range: e.version?.range ?? "", version: e.version?.artifactVersion ?? "", path: e.path, jar: { ...jar, notes: [] } });
  }
  return out;
}

/** jarMods of a jar on disk: only the entries read are held in memory. */
export function jarModsOnDisk(file: string): JarMods {
  const zip = openZipOnDisk(file);
  try {
    return jarMods(zip);
  } finally {
    zip.close?.();
  }
}

/**
 * The lock's jars as far as they are on this machine: the jar cache (Lock's dist/cache/lock-jars), then, for a
 * private jar, the private jars folder. Only the very file the lock names counts; a jar not found is null.
 */
export async function readLockJars(lock: Pick<LockFile, "files">, dirs: { cache: string; privateDir?: string }): Promise<Map<string, JarMods | null>> {
  const out = new Map<string, JarMods | null>();
  for (const f of lock.files) {
    const places = [path.join(dirs.cache, f.filename), ...(privateJarOf(f.url) && dirs.privateDir ? [path.join(dirs.privateDir, f.filename)] : [])];
    let found: JarMods | null = null;
    for (const at of places) {
      if ((await sha512File(at)) !== f.sha512) continue;
      found = jarModsOnDisk(at);
      break;
    }
    out.set(f.filename, found);
  }
  return out;
}

// ---- The check ----

export type DepProblem = { level: "error" | "warn"; message: string };
/**
 * NeoForge's VersionSupportMatrix: on Minecraft 1.21.1 a mod that accepts 1.21 is taken as accepting 1.21.1 too, so
 * JEI's and Alternate Current's `minecraft [1.21,1.21.1)` load on the server (they do, on live).
 */
const MINECRAFT_ALSO: Record<string, string[]> = { "1.21.1": ["1.21"] };
type Game = Pick<LockFile, "minecraft" | "neoforge">;
type Provided = { version: string | null; source: string; via?: string };

const label = (p: Provided) => `${p.version ?? "(version not given)"} (${p.source}${p.via ? `, as ${p.via}` : ""})`;

/**
 * One set of jars as one game loads them (`client`: a PC; `server`: the server). Which copy of each jar-in-jar
 * library loads is NeoForge's choice: per jar-in-jar identifier (group:artifact) the newest version every jar
 * carrying it accepts; a mod in the mods folder itself wins over any jar-in-jar copy of it. The same mod id under
 * two identifiers in two versions may load as either (Create's Flywheel 1.0.6 as `…:flywheel-neoforge-1.21.1` and
 * Vanillin's 1.0.4 as `…:neoforge`: PCs loaded 1.0.4), so every such version is held to each range, and the two
 * versions are named as an error when a range refuses one of them, as a warning when every range takes each (Create
 * and Vanillin alone both take flywheel [1.0.0,2.0), and live has run on that since October).
 */
export function checkJarSet(files: Array<{ slug: string; jar: JarMods | null }>, game: Game, side: "client" | "server"): DepProblem[] {
  const problems: DepProblem[] = [];
  const error = (message: string) => problems.push({ level: "error", message });
  const warn = (message: string) => problems.push({ level: "warn", message });

  const loaded: Array<{ mod: ModDecl; source: string }> = [];
  const provided = new Map<string, Provided[]>();
  const add = (modId: string, p: Provided) => {
    const list = provided.get(modId) ?? [];
    list.push(p);
    provided.set(modId, list);
  };
  for (const f of files) {
    for (const mod of f.jar?.mods ?? []) {
      const twin = provided.get(mod.modId)?.[0];
      if (twin && twin.source !== f.slug) error(`${mod.modId} is in two jars of the mods folder: ${label(twin)} and ${label({ version: mod.version, source: f.slug })}`);
      add(mod.modId, { version: mod.version, source: f.slug });
      loaded.push({ mod, source: f.slug });
    }
  }
  const topLevel = new Map([...provided].map(([id, list]) => [id, list[0]!]));

  // jar-in-jar: every library any jar carries, at any depth, by identifier
  type Candidate = Nested & { source: string };
  const byId = new Map<string, Candidate[]>();
  const walk = (jar: JarMods, source: string) => {
    for (const n of jar.nested) {
      const c = { ...n, source: `${source} > ${path.posix.basename(n.path)}` };
      byId.set(n.id, [...(byId.get(n.id) ?? []), c]);
      walk(n.jar, c.source);
    }
  };
  for (const f of files) if (f.jar) walk(f.jar, f.slug);
  for (const [id, cands] of byId) {
    const ranges = cands.map((c) => {
      try {
        return parseRange(c.range);
      } catch (e) {
        warn(`jar-in-jar ${id} in ${c.source}: its range cannot be read (${e instanceof Error ? e.message : String(e)})`);
        return parseRange("");
      }
    });
    const fits = cands.filter((c) => ranges.every((r) => inRange(r, c.version)));
    if (!fits.length) {
      error(`jar-in-jar ${id}: no copy fits every jar that carries it: ${cands.map((c) => `${c.source} has ${c.version} and accepts ${c.range}`).join("; ")}`);
      continue;
    }
    const chosen = fits.reduce((best, c) => (compareVersions(c.version, best.version) > 0 ? c : best));
    for (const mod of chosen.jar.mods) {
      const top = topLevel.get(mod.modId);
      if (top) {
        if (top.version !== mod.version) warn(`${mod.modId}: ${chosen.source} carries ${mod.version ?? "(version not given)"}, but ${label(top)} is in the mods folder and is the one that loads`);
        continue;
      }
      add(mod.modId, { version: mod.version, source: chosen.source, via: id });
      loaded.push({ mod, source: chosen.source });
    }
  }
  // a warning until a range refuses one of the versions (below), then an error
  const twoVersions = new Map<string, DepProblem>();
  for (const [modId, list] of provided) {
    const versions = new Set(list.map((p) => p.version));
    if (versions.size < 2 || topLevel.has(modId)) continue;
    const p: DepProblem = { level: "warn", message: `${modId} comes in ${versions.size} versions, and which one loads is not certain: ${list.map(label).join(" and ")}` };
    problems.push(p);
    twoVersions.set(modId, p);
  }
  // NeoForge and Minecraft are there whatever the jars say
  if (!provided.has("minecraft")) provided.set("minecraft", [{ version: game.minecraft, source: "Minecraft" }]);
  if (!provided.has("neoforge")) provided.set("neoforge", [{ version: game.neoforge, source: "NeoForge" }]);

  const unread = files.filter((f) => !f.jar).map((f) => f.slug);
  const wanted = side === "client" ? "CLIENT" : "SERVER";
  for (const { mod, source } of loaded) {
    const who = `${mod.modId} ${mod.version ?? "(version not given)"} (${source})`;
    for (const dep of mod.deps) {
      if (dep.side !== "BOTH" && dep.side !== wanted) continue;
      if (dep.modId === mod.modId) continue;
      let range: VersionRange;
      try {
        range = parseRange(dep.range);
      } catch (e) {
        error(`${who}: its range for ${dep.modId} cannot be read, and NeoForge refuses it too (${e instanceof Error ? e.message : String(e)})`);
        continue;
      }
      const shown = dep.range.trim() || "any version";
      const have = (provided.get(dep.modId) ?? []).filter((p, n, all) => all.findIndex((q) => q.version === p.version) === n);
      if (!have.length) {
        if (dep.type !== "required") continue;
        if (unread.length) warn(`${who} requires ${dep.modId} ${shown}, which none of the jars read here has (not read: ${unread.join(", ")})`);
        else error(`${who} requires ${dep.modId} ${shown}, which is not in the pack`);
        continue;
      }
      const refused = (message: string) => {
        error(message);
        const two = twoVersions.get(dep.modId);
        if (two) two.level = "error";
      };
      for (const p of have) {
        if (p.version === null) continue; // nothing to hold it to
        const fits = inRange(range, p.version) || (dep.modId === "minecraft" && (MINECRAFT_ALSO[p.version] ?? []).some((v) => inRange(range, v)));
        if (dep.type === "required" && !fits) refused(`${who} requires ${dep.modId} ${shown}, but the pack has ${dep.modId} ${label(p)}`);
        if (dep.type === "optional" && !fits) refused(`${who} works with ${dep.modId} ${shown} only, but the pack has ${dep.modId} ${label(p)}`);
        if (dep.type === "incompatible" && fits) refused(`${who} is incompatible with ${dep.modId} ${shown}, and the pack has ${dep.modId} ${label(p)}`);
        if (dep.type === "discouraged" && fits) warn(`${who} discourages ${dep.modId} ${shown}, and the pack has ${dep.modId} ${label(p)}`);
      }
    }
  }
  for (const p of twoVersions.values()) if (p.level === "warn") p.message += "; every mod that names it takes each";
  return problems;
}

/**
 * The whole lock: PCs (everything but server-only) and the server (everything but client-only), with no season
 * shipped, each season on its own, and all of them (shippedFiles). A problem says where it is, and the seasons it
 * needs when it is not there in every case. `jars` holds each file's JarMods by filename, null where not read.
 */
export function checkPackDependencies(lock: Pick<LockFile, "files" | "minecraft" | "neoforge">, jars: Map<string, JarMods | null>): DepProblem[] {
  const seasons = [...new Set(lock.files.flatMap((f) => (f.season ? [f.season] : [])))].sort();
  const variants: string[][] = [[], ...seasons.map((s) => [s]), ...(seasons.length > 1 ? [seasons] : [])];
  const seen = new Map<string, { level: DepProblem["level"]; sides: Set<string>; variants: Set<number> }>();
  variants.forEach((ship, v) => {
    const files = shippedFiles(lock, ship);
    for (const side of ["client", "server"] as const) {
      const set = files.filter((f) => (side === "client" ? f.side !== "server" : f.side !== "client"));
      for (const p of checkJarSet(set.map((f) => ({ slug: f.slug, jar: jars.get(f.filename) ?? null })), lock, side)) {
        const s = seen.get(p.message) ?? { level: p.level, sides: new Set(), variants: new Set() };
        if (p.level === "error") s.level = "error";
        s.sides.add(side);
        s.variants.add(v);
        seen.set(p.message, s);
      }
    }
  });
  const out: DepProblem[] = [];
  for (const [message, s] of seen) {
    const where = s.sides.size === 2 ? "on PCs and the server" : s.sides.has("client") ? "on PCs" : "on the server";
    const when = s.variants.size === variants.length ? "" : ` (${[...s.variants].map((v) => (v === 0 ? "with no season shipped" : `with ${variants[v]!.map((x) => `Season ${x}`).join(" and ")} shipped`)).join("; ")})`;
    out.push({ level: s.level, message: `${where}: ${message}${when}` });
  }
  for (const f of lock.files) for (const n of jars.get(f.filename)?.notes ?? []) out.push({ level: "warn", message: `${f.slug}: ${n}` });
  const unread = lock.files.filter((f) => !jars.get(f.filename));
  if (unread.length) out.push({ level: "warn", message: `dependencies: ${unread.length} of ${lock.files.length} jars not read, so not checked: ${unread.map((f) => f.slug).join(", ")}` });
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
}
