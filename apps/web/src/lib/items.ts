// How an item id reads to a person: "minecraft:diamond_pickaxe" → "Diamond Pickaxe", from "Minecraft".
// No textures yet (docs/13 §11: icons from the pack's own files come later); a tile with the name's initials and a
// colour worked out from the id, so the same item always looks the same.

const title = (s: string) => s.split(/[_\-.]/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

export function itemName(id: string): string {
  const name = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  return title(name.split("/").at(-1) ?? name);
}

const MODS: Record<string, string> = {
  minecraft: "Minecraft", create: "Create", createaddition: "Create: Crafts & Additions", sophisticatedbackpacks: "Sophisticated Backpacks",
  sophisticatedcore: "Sophisticated Core", tacz: "TaCZ", waystones: "Waystones", farmersdelight: "Farmer's Delight", pipez: "Pipez",
  corpse: "Corpse", jei: "Just Enough Items", mekanism: "Mekanism", ae2: "Applied Energistics 2", immersiveengineering: "Immersive Engineering",
};
export function itemMod(id: string): string {
  const ns = id.includes(":") ? id.slice(0, id.indexOf(":")) : "minecraft";
  return MODS[ns] ?? title(ns);
}

export function itemInitials(id: string): string {
  const words = itemName(id).split(" ");
  return (words.length > 1 ? words[0]!.charAt(0) + words.at(-1)!.charAt(0) : words[0]!.slice(0, 2)).toUpperCase();
}

/** A stable hue for an item id, 0..359. */
export function itemHue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
export const enchantLabel = (id: string, level: number) => `${itemName(id)}${level > 1 || level === 0 ? ` ${ROMAN[level] ?? level}` : ""}`;

export const DIMENSION: Record<string, string> = { "minecraft:overworld": "Overworld", "minecraft:the_nether": "The Nether", "minecraft:the_end": "The End", "deepslate:limbo": "Entrance room" };
export const GAME_MODE = ["Survival", "Creative", "Adventure", "Spectator"];
