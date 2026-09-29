// docs/16 §3: how Admin → Files shows particular files. Pure, so it can be tested.

export type Prop = { key: string; value: string; line: number; expected?: string; differs: boolean };

/** server.properties as rows, with what the manifest expects where it says something. */
export function readProperties(text: string, expected: Record<string, string> = {}): { rows: Prop[]; missing: Array<{ key: string; expected: string }> } {
  const rows: Prop[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) return;
    const m = /^([^=:\s]+)\s*[=:]\s*(.*)$/.exec(line);
    if (!m) return;
    const key = m[1]!;
    const value = m[2]!.replace(/\\:/g, ":").replace(/\\=/g, "=");
    seen.add(key);
    const want = expected[key];
    rows.push({ key, value, line: i + 1, expected: want, differs: want !== undefined && want.trim().toLowerCase() !== value.trim().toLowerCase() });
  });
  const missing = Object.entries(expected).filter(([k]) => !seen.has(k)).map(([key, e]) => ({ key, expected: e }));
  return { rows, missing };
}

export type Table = { columns: string[]; rows: string[][] };
const KNOWN: Record<string, string[]> = {
  "whitelist.json": ["name", "uuid"],
  "ops.json": ["name", "uuid", "level", "bypassesPlayerLimit"],
  "banned-players.json": ["name", "uuid", "reason", "source", "created", "expires"],
  "banned-ips.json": ["ip", "reason", "source", "created", "expires"],
  "usercache.json": ["name", "uuid", "expiresOn"],
};

/** The JSON lists Minecraft keeps (whitelist, ops, bans) as a table. Null when the file is not one of them or not a list. */
export function readList(name: string, text: string): Table | null {
  const columns = KNOWN[name];
  if (!columns) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const rows = data.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object").map((r) => columns.map((c) => (r[c] === undefined || r[c] === null ? "" : String(r[c]))));
  return { columns, rows };
}

export type Token = { text: string; kind: "plain" | "comment" | "key" | "string" | "number" | "word" };

/** Light colouring, line by line. Not a parser: it never changes the text, only says what each piece looks like. */
export function colour(line: string, ext: string): Token[] {
  if (line === "") return [{ text: "", kind: "plain" }];
  if (["properties", "toml", "conf", "cfg", "yml", "yaml", "ini", "sh", "bat", "txt", ""].includes(ext)) {
    const t = line.trimStart();
    if (t.startsWith("#") || t.startsWith("//") || (ext === "ini" && t.startsWith(";")) || (ext === "bat" && /^(rem|::)/i.test(t))) return [{ text: line, kind: "comment" }];
  }
  if (["properties", "toml", "conf", "cfg", "yml", "yaml", "ini"].includes(ext)) {
    const m = /^(\s*)([^=:#\s][^=:]*?)(\s*[=:]\s*)(.*)$/.exec(line);
    if (m) return [{ text: m[1]!, kind: "plain" }, { text: m[2]!, kind: "key" }, { text: m[3]!, kind: "plain" }, ...value(m[4]!)];
    if (/^\s*\[.*\]\s*$/.test(line)) return [{ text: line, kind: "word" }];
    return [{ text: line, kind: "plain" }];
  }
  if (ext === "json" || ext === "json5" || ext === "mcmeta") {
    const out: Token[] = [];
    const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([^"\-\dtfn]+|.)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (m[1]) {
        out.push({ text: m[1], kind: m[2] ? "key" : "string" });
        if (m[2]) out.push({ text: m[2], kind: "plain" });
      } else if (m[3]) out.push({ text: m[3], kind: "number" });
      else if (m[4]) out.push({ text: m[4], kind: "word" });
      else out.push({ text: m[5]!, kind: "plain" });
    }
    return out;
  }
  if (ext === "log") {
    const m = /^(\[[^\]]*\]\s*)(\[[^\]]*\/(WARN|ERROR|FATAL)\])(.*)$/.exec(line);
    if (m) return [{ text: m[1]!, kind: "comment" }, { text: m[2]!, kind: m[3] === "WARN" ? "number" : "word" }, { text: m[4]!, kind: "plain" }];
    const t = /^(\[[^\]]*\]\s*)(.*)$/.exec(line);
    if (t) return [{ text: t[1]!, kind: "comment" }, { text: t[2]!, kind: "plain" }];
  }
  return [{ text: line, kind: "plain" }];
}

function value(v: string): Token[] {
  const hash = v.search(/\s#/);
  const body = hash >= 0 ? v.slice(0, hash) : v;
  const rest: Token[] = hash >= 0 ? [{ text: v.slice(hash), kind: "comment" }] : [];
  const t = body.trim();
  const kind: Token["kind"] = /^(true|false|null)$/i.test(t) ? "word" : /^-?\d+(\.\d+)?$/.test(t) ? "number" : /^["'].*["']$/.test(t) ? "string" : "plain";
  return [{ text: body, kind }, ...rest];
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

export type SortKey = "name" | "size" | "modified";
export function sortEntries<T extends { name: string; dir: boolean; size: number; modified: string | null }>(entries: T[], key: string | undefined, dir: string | undefined): T[] {
  const k: SortKey = key === "size" || key === "modified" ? key : "name";
  const sign = dir === "desc" ? -1 : 1;
  return [...entries].sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1; // folders stay on top either way
    const byName = a.name.localeCompare(b.name, "en", { sensitivity: "base" });
    if (k === "size") return sign * (a.size - b.size) || byName;
    if (k === "modified") return sign * ((Date.parse(a.modified ?? "") || 0) - (Date.parse(b.modified ?? "") || 0)) || byName;
    return sign * byName;
  });
}
