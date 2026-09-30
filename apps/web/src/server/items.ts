import "server-only";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { P } from "@/server/modpack/lock";

// docs/13 §13: the item catalogue that `modpack build items` writes (dist/items), for the inventory editor's picker.

export type CatalogueItem = { id: string; name: string; mod: string; maxStack: number | null; icon: string | null };
let cache: { mtime: number; items: CatalogueItem[] } | null = null;

export async function getCatalogue(): Promise<CatalogueItem[]> {
  const file = path.join(P.dist, "items", "catalogue.json");
  const m = (await stat(file).catch(() => null))?.mtimeMs ?? 0;
  if (!m) return [];
  if (!cache || cache.mtime !== m) cache = { mtime: m, items: (JSON.parse(await readFile(file, "utf8")) as { items: CatalogueItem[] }).items };
  return cache.items;
}

/** The picture's file, when the path is one the build writes: <namespace>/<path>.png, nothing else. */
export function iconFile(rel: string): string | null {
  if (!/^[a-z0-9_.-]{1,64}\/[a-z0-9_./-]{1,160}\.png$/.test(rel) || rel.includes("..")) return null;
  return path.join(P.dist, "items", "icons", rel);
}
