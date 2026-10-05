import type { GuideSection, KeyBind, Manifest, Video } from "modpack";

// The Mods guide (/mods, planner 2026-10-01): generated from modpack/mods.json and modpack/extras.json, never
// written by hand, so it follows the pack. Pure, so it is tested.

export type Where = "everyone" | "optional" | "server";
export type GuideCard = {
  /** The anchor: /mods#create. A mod's slug, an extra's id. */
  id: string;
  name: string;
  description: string;
  howTo: string | null;
  keys: KeyBind[];
  video: Video | null;
  wiki: string | null;
  where: Where;
  icon: string | null;
  /** The coming season's: listed to admins only (mods.json `adminOnly`). */
  adminOnly: boolean;
};
export type GuidePart = { key: GuideSection | "extras"; title: string; blurb: string; cards: GuideCard[]; collapsed: boolean };

export type ExtraEntry = { id: string; name: string; description: string; howTo?: string; keys?: KeyBind[]; projects: Array<{ slug: string }> };

const PARTS: Array<{ key: GuidePart["key"]; title: string; blurb: string }> = [
  { key: "game", title: "What's in the game", blurb: "The mods that change what you can do. Everyone has these." },
  { key: "helper", title: "Helpers", blurb: "Small things on your screen that make everything else easier." },
  { key: "extras", title: "Your extras", blurb: "Optional, only on your PC: switch them on in the Deepslate Works app's Extras tab. Nobody else needs them." },
  { key: "behind", title: "Behind the scenes", blurb: "Performance and server-only mods. Nothing to learn: they just make the game run better." },
];

/** Anchors are slugs and ids; both are already safe ([a-z0-9._-]). */
export const anchorOf = (id: string) => id.replace(/[^a-z0-9._-]/gi, "-").toLowerCase();

/**
 * The page's four parts. Only mods that are switched on and not a dependency, and admin-only ones only for an admin;
 * a part with nothing in it is left out. `icons` maps a Modrinth slug to its icon (mods), `pictures` an extra's id to
 * its PNG (extras).
 */
export function guideParts(m: Pick<Manifest, "mods">, extras: ExtraEntry[], icons: Record<string, string> = {}, pictures: Record<string, string> = {}, admin = false): GuidePart[] {
  const mods = m.mods.filter((x) => x.enabled && !x.hidden && (admin || !x.adminOnly));
  const card = (x: Manifest["mods"][number]): GuideCard => ({
    id: anchorOf(x.slug),
    name: x.name,
    description: x.description,
    howTo: x.howTo ?? null,
    keys: x.keys ?? [],
    video: x.videos[0] ?? null,
    wiki: x.wiki || null,
    where: x.side === "server" ? "server" : "everyone",
    icon: icons[x.slug] ?? null,
    adminOnly: x.adminOnly === true,
  });
  const extra = (x: ExtraEntry): GuideCard => ({
    id: anchorOf(x.id),
    name: x.name,
    description: x.description,
    howTo: x.howTo ?? null,
    keys: x.keys ?? [],
    video: null,
    wiki: x.projects[0] ? `https://modrinth.com/project/${x.projects[0].slug}` : null,
    where: "optional",
    icon: pictures[x.id] ?? (x.projects[0] ? icons[x.projects[0].slug] ?? null : null),
    adminOnly: false,
  });
  return PARTS.map((p) => ({
    ...p,
    collapsed: p.key === "behind",
    cards: p.key === "extras" ? extras.map(extra) : mods.filter((x) => (x.guide ?? "behind") === p.key).map(card),
  })).filter((p) => p.cards.length > 0);
}

/** What the search box looks in: name, what it does, how to use it, the keys. Lower case. */
export function searchText(c: GuideCard): string {
  return [c.name, c.id, c.description, c.howTo ?? "", ...c.keys.flatMap((k) => [k.key, k.does])].join(" ").toLowerCase();
}

/** Every word of the query somewhere in the card. An empty query matches everything. */
export function matches(text: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => text.includes(w));
}

export const WHERE_TEXT: Record<Where, string> = { everyone: "In everyone's game", optional: "Optional, your PC only", server: "On the server only" };
