// Admin → Server → Settings: what is lying around on the server, and clearing items on the ground (planner,
// 2026-10-01). The api counts and clears (apps/api/src/status/ground.ts); this is how the card words it.

export const COUNTED = ["items", "xp", "hostile", "passive", "contraptions", "corpses", "all"] as const;
export type Counted = (typeof COUNTED)[number];

export type Ground = {
  plan: { auto: boolean; threshold: number };
  counts: { at: string; values: Partial<Record<Counted, number>>; problems: Partial<Record<Counted, string>> } | null;
  clearing: { by: "button" | "schedule"; step: "warned60" | "warned10" | "clearing"; clearsAt: string } | null;
  last: { at: string; removed: number | null; by: "button" | "schedule"; before: number | null; problem: string | null } | null;
  running: boolean;
  oldAfterSeconds: number;
  checkEveryMin: number;
};

export const LABELS: Record<Counted, { name: string; hint: string }> = {
  items: { name: "Items on the ground", hint: "Each dropped stack is one entity. Thousands of them are the usual cause of lag on a modded server." },
  xp: { name: "XP orbs", hint: "Usually from mob farms or smelting. They merge by themselves." },
  hostile: { name: "Hostile mobs", hint: "Zombies, skeletons, creepers and the rest; the game caps natural spawning, farms can go past it." },
  passive: { name: "Animals and villagers", hint: "Farm animals, pets, villagers, fish. Big animal pens and trading halls show up here." },
  contraptions: { name: "Create contraptions", hint: "Moving Create machines: drills, trains, gantries, anything glued and moving." },
  corpses: { name: "Corpses", hint: "Bodies of players who died. Never cleared." },
  all: { name: "Everything", hint: "All entities in loaded chunks, players included." },
};

/** Thresholds for the colour of a count: what is normal for a handful of players. */
const BUSY: Partial<Record<Counted, [number, number]>> = { items: [500, 1500], xp: [200, 1000], hostile: [300, 700], passive: [300, 800], contraptions: [50, 150], all: [1500, 4000] };

export function countTone(what: Counted, n: number): "good" | "warn" | "bad" | "neutral" {
  const b = BUSY[what];
  if (!b) return "neutral";
  return n >= b[1] ? "bad" : n >= b[0] ? "warn" : "good";
}

/** The schedule in one line, for the card and its form. */
export function planText(p: Ground["plan"], everyMin = 10): string {
  return p.auto ? `On: every ${everyMin} minutes, clears when more than ${p.threshold.toLocaleString("en-GB")} items are lying around.` : "Off. Items are only cleared when someone presses the button.";
}

/** What a running clear is doing, in words. */
export function clearingText(c: NonNullable<Ground["clearing"]>, now = Date.now()): string {
  if (c.step === "clearing") return "Clearing now…";
  const left = Math.max(0, Math.round((Date.parse(c.clearsAt) - now) / 1000));
  return `Players have been warned; clearing in about ${left} s${c.by === "schedule" ? " (automatic)" : ""}.`;
}
