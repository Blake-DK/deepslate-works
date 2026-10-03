import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// A server file may render a client module's components but never call its functions: Next throws "Attempted to call
// X() from the server but X is on the client" on every request (2026-10-03: stripLink, the whole signed-in site down).
// Components are PascalCase; anything else imported from a "use client" file by a server file fails here.

const SRC = path.resolve(__dirname, "..", "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}
const isClient = (src: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(src);

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const f of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) if (existsSync(f) && statSync(f).isFile()) return f;
  return null;
}

/** Value names a file imports from each module (type-only imports left out). */
function imports(src: string): Array<{ spec: string; names: string[] }> {
  return [...src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)]
    .filter((m) => !m[1])
    .map((m) => ({ spec: m[3]!, names: m[2]!.split(",").map((n) => n.trim()).filter((n) => n && !n.startsWith("type ")).map((n) => n.split(/\s+as\s+/)[0]!.trim()) }));
}

export function boundaryProblems(): string[] {
  const out: string[] = [];
  for (const f of files(SRC)) {
    const src = readFileSync(f, "utf8");
    if (isClient(src)) continue;
    for (const { spec, names } of imports(src)) {
      const target = resolve(f, spec);
      if (!target || !isClient(readFileSync(target, "utf8"))) continue;
      for (const n of names) if (!/^[A-Z]/.test(n)) out.push(`${path.relative(SRC, f)} imports ${n} from client module ${spec}`);
    }
  }
  return out;
}

describe("the client boundary", () => {
  it("no server file imports a function (only components) from a \"use client\" module", () => {
    expect(boundaryProblems()).toEqual([]);
  });
  it("knows a client module when it sees one", () => {
    expect(isClient('"use client";\nimport x from "y";')).toBe(true);
    expect(isClient("// a note\n'use client';")).toBe(true);
    expect(isClient('import x from "y";\n"use client";')).toBe(false);
  });
});
