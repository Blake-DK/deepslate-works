import type { GuideSection, KeyBind, Manifest, Video } from "modpack";
import { GUIDE_TOPICS, type GuideTopic } from "modpack/schema";

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
/**
 * docs/52: the "game" mods come as one section per topic (`topic-travel`, …), then the other parts as before. "game"
 * is left only for a "game" mod without a topic, which lint refuses but an older mods.json (a held checkout) has.
 */
export type GuidePartKey = `topic-${GuideTopic}` | GuideSection | "extras";
export type GuidePart = {
  key: GuidePartKey;
  /** Its heading's id, for the row of links: `topic-<id>` for a topic, `part-<key>` for the others (clear of mod anchors). */
  anchor: string;
  title: string;
  blurb: string;
  cards: GuideCard[];
  collapsed: boolean;
};

export type ExtraEntry = { id: string; name: string; description: string; howTo?: string; keys?: KeyBind[]; projects: Array<{ slug: string }> };

// docs/52: the sections "What's in the game" became, in GUIDE_TOPICS's order.
const TOPICS: Record<GuideTopic, { title: string; blurb: string }> = {
  travel: { title: "Getting around", blurb: "Maps, waypoints and fast travel." },
  friends: { title: "Friends and survival", blurb: "Playing with the others, keeping your land and getting your things back when you die." },
  mining: { title: "Mining and gathering", blurb: "Getting ore and wood out of the ground faster." },
  storage: { title: "Storage and moving things", blurb: "Carrying more, storing more and moving items without carrying them." },
  building: { title: "Building and decoration", blurb: "Extra blocks and furniture for making a base look good." },
  factories: { title: "Factories and power", blurb: "Machines, power and automation." },
  farming: { title: "Farming and food", blurb: "Crops, cooking and meals." },
  animals: { title: "Animals", blurb: "New animals out in the world, and a few you can tame or keep." },
  combat: { title: "Combat", blurb: "Guns and cannons." },
  bosses: { title: "Bosses and trials", blurb: "Big fights out in the world." },
};

const PARTS: Array<{ key: Exclude<GuidePartKey, `topic-${string}`>; title: string; blurb: string }> = [
  { key: "game", title: "What's in the game", blurb: "The mods that change what you can do. Everyone has these." },
  { key: "helper", title: "Helpers", blurb: "Small things on your screen that make everything else easier." },
  { key: "extras", title: "Your extras", blurb: "Optional, only on your PC: switch them on in the Deepslate Works app's Extras tab. Nobody else needs them." },
  { key: "behind", title: "Behind the scenes", blurb: "Performance and server-only mods. Nothing to learn: they just make the game run better." },
];

/** Anchors are slugs and ids; both are already safe ([a-z0-9._-]). */
export const anchorOf = (id: string) => id.replace(/[^a-z0-9._-]/gi, "-").toLowerCase();

/**
 * The page's parts: a section per topic (docs/52), then Helpers, Your extras, Behind the scenes. Only mods that are
 * switched on and not a dependency, and admin-only ones only for an admin; a part with nothing in it is left out. `icons` maps a Modrinth slug to its icon (mods), `pictures` an extra's id to
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
  const topics: GuidePart[] = GUIDE_TOPICS.map((t) => ({
    key: `topic-${t}` as const,
    anchor: `topic-${t}`,
    ...TOPICS[t],
    collapsed: false,
    cards: mods.filter((x) => x.guide === "game" && x.topic === t).map(card),
  }));
  const rest: GuidePart[] = PARTS.map((p) => ({
    ...p,
    anchor: `part-${p.key}`,
    collapsed: p.key === "behind",
    cards: p.key === "extras" ? extras.map(extra) : mods.filter((x) => (x.guide ?? "behind") === p.key && !(p.key === "game" && x.topic)).map(card),
  }));
  return [...topics, ...rest].filter((p) => p.cards.length > 0);
}

/** What the search box looks in: name, what it does, how to use it, the keys. Lower case. */
export function searchText(c: GuideCard): string {
  return [c.name, c.id, c.description, c.howTo ?? "", ...c.keys.flatMap((k) => [k.key, k.does])].join(" ").toLowerCase();
}

export { matches } from "./mods-search";

export const WHERE_TEXT: Record<Where, string> = { everyone: "In everyone's game", optional: "Optional, your PC only", server: "On the server only" };
