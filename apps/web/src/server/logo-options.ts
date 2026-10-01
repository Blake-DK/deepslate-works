import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// branding/logo-options: eight logos the planner drew (2026-10-01). In the image at /app/branding/logo-options
// (the web image copies the whole repo); LOGO_OPTIONS_DIR overrides.
export const OPTIONS_DIR = process.env.LOGO_OPTIONS_DIR ?? path.resolve(process.cwd(), "..", "..", "branding", "logo-options");
const ID = /^[0-9]-[a-z0-9-]{1,50}$/;

export type LogoOption = { id: string; title: string; idea: string; pixel: boolean };

/** Pure: the idea of each file, from the README's table (| file.svg | idea |). */
export function ideas(readme: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of readme.matchAll(/^\|\s*([0-9]-[a-z0-9-]+)\.svg\s*\|\s*(.+?)\s*\|\s*$/gm)) out[m[1]!] = m[2]!;
  return out;
}

/** Pure: "2-ore-block" → "Ore block". */
export function titleOf(id: string): string {
  const t = id.replace(/^[0-9]-/, "").replace(/-/g, " ");
  return (t.charAt(0).toUpperCase() + t.slice(1)).replace(/\bdw\b/i, "DW");
}

export async function listOptions(): Promise<LogoOption[]> {
  try {
    const files = (await readdir(OPTIONS_DIR)).filter((f) => f.endsWith(".svg") && ID.test(f.slice(0, -4))).sort();
    const readme = await readFile(path.join(OPTIONS_DIR, "README.md"), "utf8").catch(() => "");
    const idea = ideas(readme);
    return await Promise.all(
      files.map(async (f) => {
        const id = f.slice(0, -4);
        const svg = await readFile(path.join(OPTIONS_DIR, f), "utf8");
        return { id, title: titleOf(id), idea: idea[id] ?? "", pixel: /viewBox="0 0 16 16"/.test(svg) && /crispEdges/.test(svg) };
      }),
    );
  } catch {
    return [];
  }
}

export async function readOption(id: string): Promise<string | null> {
  if (!ID.test(id)) return null;
  try {
    return await readFile(path.join(OPTIONS_DIR, `${id}.svg`), "utf8");
  } catch {
    return null;
  }
}
