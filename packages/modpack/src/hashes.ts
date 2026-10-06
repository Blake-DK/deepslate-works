import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

// The checksums the lock keeps of the pack's settings and resource pack (docs/06). On their own, without lock.ts's
// Modrinth and jar code, so that the site can tell whether the lock still matches the files (pending.ts).

export type ConfigHash = { path: string; sha256: string };

/** Every file under `configDir`, as "config/<relative path>" and its SHA-256, in a stable order. */
export async function hashConfigs(configDir: string): Promise<ConfigHash[]> {
  const out: ConfigHash[] = [];
  async function walk(dir: string, rel: string) {
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      const full = path.join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      const s = await stat(full);
      if (s.isDirectory()) await walk(full, relPath);
      else out.push({ path: `config/${relPath}`, sha256: createHash("sha256").update(await readFile(full)).digest("hex") });
    }
  }
  await walk(configDir, "");
  return out;
}

/** One hash over every file of modpack/resourcepack/ (path + content), or undefined without a pack.mcmeta. */
export async function hashResourcePack(dir: string | undefined): Promise<string | undefined> {
  if (!dir) return undefined;
  // The same files Build puts into the pack (docs/31 B-30): README.md is for whoever drops textures in, is left
  // out of the zip, and so must not move the pack's version when it is edited.
  const files = (await hashConfigs(dir)).filter((c) => c.path !== "config/README.md");
  if (!files.some((c) => c.path === "config/pack.mcmeta")) return undefined;
  return createHash("sha256").update(files.map((c) => `${c.path}@${c.sha256}`).join("\n")).digest("hex");
}
