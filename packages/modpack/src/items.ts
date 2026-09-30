import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { openZip, type Zip } from "./zip";

// docs/13 §13: the item catalogue for the admin's inventory editor. Every item the server knows, with a name, the mod
// it comes from, its stack size where known and an icon. Vanilla: the list and stack sizes from Minecraft's own data
// report (modpack/items/vanilla-1.21.1.json), names, models and textures from the client jar (downloaded from Mojang,
// checked against its SHA-1). Mods: the item models, English names and textures in each server jar.
// Written to dist/items/catalogue.json and dist/items/icons/<namespace>/<path>.png.

export type CatalogueItem = { id: string; name: string; mod: string; maxStack: number | null; icon: string | null };
export type Catalogue = { minecraft: string; builtAt: string; items: CatalogueItem[] };
type Vanilla = { minecraft: string; client: { url: string; sha1: string }; items: Record<string, number> };

const TEXTURE_KEYS = ["layer0", "all", "side", "front", "top", "particle", "texture", "cross", "plant", "end"];

/** "Andesite Alloy" from "andesite_alloy", when a mod has no English name for it. */
export const titleOf = (p: string) => p.split(/[_/]/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");

type Sources = Array<{ zip: Zip }>;

function readJson(zip: Zip, name: string): Record<string, unknown> | null {
  const b = zip.read(name);
  if (!b) return null;
  try { return JSON.parse(b.toString("utf8").replace(/^﻿/, "")) as Record<string, unknown>; } catch { return null; }
}

/** "ns:item/x" or "item/x" -> ["ns", "item/x"] */
const splitId = (ref: string, ns = "minecraft") => (ref.includes(":") ? [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)] : [ns, ref]) as [string, string];

function findModel(srcs: Sources, ns: string, p: string) {
  for (const s of srcs) {
    const j = readJson(s.zip, `assets/${ns}/models/${p}.json`);
    if (j) return j;
  }
  return null;
}
function findTexture(srcs: Sources, ns: string, p: string): Buffer | null {
  for (const s of srcs) {
    const b = s.zip.read(`assets/${ns}/textures/${p}.png`);
    if (b) return b;
  }
  return null;
}

/** An item model's picture: its own layer0, or its block's texture, following parents and #variables. */
export function iconFor(srcs: Sources, id: string): Buffer | null {
  const [ns, name] = splitId(id);
  let model = findModel(srcs, ns, `item/${name}`);
  const textures: Record<string, string> = {};
  for (let depth = 0; model && depth < 8; depth++) {
    const t = (model.textures ?? {}) as Record<string, string>;
    for (const [k, v] of Object.entries(t)) if (!(k in textures)) textures[k] = v;
    const parent = typeof model.parent === "string" ? model.parent : null;
    if (!parent) break;
    const [pns, pp] = splitId(parent);
    if (pp.startsWith("builtin/")) break;
    model = findModel(srcs, pns, pp);
  }
  const resolve = (v: string | undefined, hops = 0): string | null => (v === undefined || hops > 8 ? null : v.startsWith("#") ? resolve(textures[v.slice(1)], hops + 1) : v);
  for (const key of [...TEXTURE_KEYS, ...Object.keys(textures)]) {
    const ref = resolve(textures[key]);
    if (!ref) continue;
    const [tns, tp] = splitId(ref);
    const png = findTexture(srcs, tns, tp);
    if (png) return png;
  }
  return null;
}

function langOf(zip: Zip, ns: string): Record<string, string> {
  return (readJson(zip, `assets/${ns}/lang/en_us.json`) as Record<string, string> | null) ?? {};
}

/** The mod's own name, from its neoforge.mods.toml; the jar's name otherwise. */
export function modNameOf(zip: Zip, fallback: string): string {
  const toml = zip.read("META-INF/neoforge.mods.toml")?.toString("utf8") ?? "";
  const m = /displayName\s*=\s*"([^"]{1,80})"/.exec(toml);
  return m ? m[1]! : fallback;
}

async function clientJar(cacheDir: string, v: Vanilla, log: (s: string) => void): Promise<Buffer> {
  const file = path.join(cacheDir, `client-${v.minecraft}.jar`);
  const sha1 = (b: Buffer) => createHash("sha1").update(b).digest("hex");
  try {
    const b = await readFile(file);
    if (sha1(b) === v.client.sha1) return b;
  } catch {}
  log(`downloading the Minecraft ${v.minecraft} client jar for item names and pictures`);
  const r = await fetch(v.client.url, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`client jar: HTTP ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  if (sha1(b) !== v.client.sha1) throw new Error("client jar: the checksum does not match Mojang's");
  await mkdir(cacheDir, { recursive: true });
  await writeFile(`${file}.tmp`, b);
  await rename(`${file}.tmp`, file);
  return b;
}

export async function buildItems(p: { dist: string; vanilla: string }, log: (s: string) => void): Promise<Catalogue> {
  const v = JSON.parse(await readFile(p.vanilla, "utf8")) as Vanilla;
  const client = openZip(await clientJar(path.join(p.dist, "cache"), v, log));
  const modsDir = path.join(p.dist, "server", "mods");
  const jars = (await readdir(modsDir).catch(() => [] as string[])).filter((f) => f.endsWith(".jar")).sort();
  const mods = await Promise.all(jars.map(async (f) => ({ file: f, zip: openZip(await readFile(path.join(modsDir, f))) })));
  const all: Sources = [{ zip: client }, ...mods.map((m) => ({ zip: m.zip }))];
  const out = path.join(p.dist, "items");
  const tmp = `${out}.tmp`;
  await rm(tmp, { recursive: true, force: true });
  const items: CatalogueItem[] = [];
  const write = async (id: string) => {
    const png = iconFor(all, id);
    if (!png) return null;
    const [ns, name] = splitId(id);
    const rel = `${ns}/${name}.png`;
    await mkdir(path.dirname(path.join(tmp, "icons", rel)), { recursive: true });
    await writeFile(path.join(tmp, "icons", rel), png);
    return rel;
  };
  const vlang = langOf(client, "minecraft");
  for (const [name, stack] of Object.entries(v.items)) {
    if (name === "air") continue;
    const id = `minecraft:${name}`;
    items.push({ id, name: vlang[`item.minecraft.${name}`] ?? vlang[`block.minecraft.${name}`] ?? titleOf(name), mod: "Minecraft", maxStack: stack, icon: await write(id) });
  }
  const seen = new Set(items.map((i) => i.id));
  for (const m of mods) {
    const mod = modNameOf(m.zip, m.file.replace(/\.jar$/, ""));
    const models = m.zip.names.map((n) => /^assets\/([a-z0-9_.-]+)\/models\/item\/([a-z0-9_./-]+)\.json$/.exec(n)).filter((x): x is RegExpExecArray => x !== null && x[1] !== "minecraft");
    const langs = new Map<string, Record<string, string>>();
    for (const [, ns, name] of models) {
      const id = `${ns}:${name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (!langs.has(ns!)) langs.set(ns!, langOf(m.zip, ns!));
      const lang = langs.get(ns!)!;
      items.push({ id, name: lang[`item.${ns}.${name}`] ?? lang[`block.${ns}.${name}`] ?? titleOf(name!), mod, maxStack: null, icon: await write(id) });
    }
  }
  items.sort((a, b) => (a.mod === b.mod ? a.name.localeCompare(b.name) : a.mod === "Minecraft" ? -1 : b.mod === "Minecraft" ? 1 : a.mod.localeCompare(b.mod)));
  const catalogue: Catalogue = { minecraft: v.minecraft, builtAt: new Date().toISOString(), items };
  await mkdir(tmp, { recursive: true });
  await writeFile(path.join(tmp, "catalogue.json"), JSON.stringify(catalogue));
  await rm(out, { recursive: true, force: true });
  await rename(tmp, out);
  const icons = items.filter((i) => i.icon).length;
  log(`items: ${items.length} (${items.filter((i) => i.mod === "Minecraft").length} Minecraft, ${items.length - items.filter((i) => i.mod === "Minecraft").length} from mods), ${icons} with a picture`);
  return catalogue;
}
