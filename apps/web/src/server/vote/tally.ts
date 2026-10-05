// Pure tally + decision logic (tested). No database, no manifest IO here.
import type { Mod } from "modpack";

export type Tier = "LOW" | "MID" | "HIGH";
export type TierKey = Tier | "UNKNOWN";
export const TIER_KEYS: TierKey[] = ["LOW", "MID", "HIGH", "UNKNOWN"];

export type Question = { id: string; text: string; options: string[] };
export type BallotRow = { modIds: string[]; answers: Record<string, string>; pcTier: Tier | null };

export type ModTally = {
  slug: string;
  yes: number;
  pct: number; // 0..100 of all ballots
  byTier: Record<TierKey, { yes: number; total: number }>;
  /** docs/05 rule: Heavy mods need a majority of the weak-PC (LOW) voters. null when nobody LOW voted. */
  lowTierMajority: boolean | null;
};

export type Tally = {
  ballots: number;
  byTier: Record<TierKey, number>;
  mods: ModTally[];
  questions: Array<{ id: string; text: string; options: Array<{ option: string; count: number }>; answered: number }>;
};

const tierKey = (t: Tier | null): TierKey => t ?? "UNKNOWN";
const emptyTiers = <T>(make: () => T): Record<TierKey, T> => ({ LOW: make(), MID: make(), HIGH: make(), UNKNOWN: make() });

export function tally(mods: Pick<Mod, "slug" | "load">[], questions: Question[], ballots: BallotRow[]): Tally {
  const byTier = emptyTiers(() => 0);
  for (const b of ballots) byTier[tierKey(b.pcTier)]++;
  const modTallies: ModTally[] = mods.map((mod) => {
    const t = emptyTiers(() => ({ yes: 0, total: 0 }));
    let yes = 0;
    for (const b of ballots) {
      const k = tierKey(b.pcTier);
      t[k].total++;
      if (b.modIds.includes(mod.slug)) {
        yes++;
        t[k].yes++;
      }
    }
    const low = t.LOW;
    const lowTierMajority = mod.load === "H" ? (low.total === 0 ? null : low.yes * 2 > low.total) : null;
    return { slug: mod.slug, yes, pct: ballots.length ? Math.round((yes / ballots.length) * 100) : 0, byTier: t, lowTierMajority };
  });
  const qs = questions.map((q) => {
    const counts = new Map(q.options.map((o) => [o, 0]));
    let answered = 0;
    for (const b of ballots) {
      const a = b.answers[q.id];
      if (a !== undefined && counts.has(a)) {
        counts.set(a, counts.get(a)! + 1);
        answered++;
      }
    }
    return { id: q.id, text: q.text, options: q.options.map((option) => ({ option, count: counts.get(option) ?? 0 })), answered };
  });
  return { ballots: ballots.length, byTier, mods: modTallies, questions: qs };
}

export type Decision = { slug: string; name: string; from: boolean; to: boolean; yes: number; pct: number; reason: string };

/**
 * docs/05 "Apply results": a mod is enabled at >= threshold of ballots; within an exclusive group only the
 * winner (most yes votes, needs at least one) is enabled. Heavy mods without LOW-tier majority are flagged
 * in `reason` but not blocked; the admin sees the diff before confirming.
 */
export function decide(mods: Mod[], t: Tally, thresholdPct = 50): Decision[] {
  const byslug = new Map(t.mods.map((m) => [m.slug, m]));
  const groupWinner = new Map<string, string | null>();
  for (const mod of mods) {
    if (!mod.exclusiveGroup || groupWinner.has(mod.exclusiveGroup)) continue;
    const members = mods.filter((m) => m.exclusiveGroup === mod.exclusiveGroup);
    const best = members
      .map((m) => ({ slug: m.slug, yes: byslug.get(m.slug)?.yes ?? 0, recommended: m.recommended }))
      .sort((a, b) => b.yes - a.yes || Number(b.recommended) - Number(a.recommended))[0];
    groupWinner.set(mod.exclusiveGroup, best && best.yes > 0 ? best.slug : null);
  }
  const out: Decision[] = [];
  for (const mod of mods) {
    const r = byslug.get(mod.slug);
    if (!r) continue;
    let to: boolean;
    let reason: string;
    if (mod.exclusiveGroup) {
      const winner = groupWinner.get(mod.exclusiveGroup);
      to = winner === mod.slug;
      reason = winner ? (to ? `wins group "${mod.exclusiveGroup}"` : `loses group "${mod.exclusiveGroup}" to ${winner}`) : `nobody picked anything in group "${mod.exclusiveGroup}"`;
    } else {
      // the count itself against the threshold; `pct` is rounded and only for showing (59.52% is not 60%)
      to = t.ballots > 0 && r.yes * 100 >= thresholdPct * t.ballots;
      reason = `${r.pct}% yes (threshold ${thresholdPct}%)`;
    }
    if (to && mod.load === "H" && r.lowTierMajority === false) reason += "; WARNING: no majority among weak-PC voters";
    out.push({ slug: mod.slug, name: mod.name, from: mod.enabled, to, yes: r.yes, pct: r.pct, reason });
  }
  return out;
}

export const DEFAULT_QUESTIONS: Question[] = [
  { id: "difficulty", text: "Difficulty", options: ["Easy", "Normal", "Hard"] },
  { id: "death", text: "When you die", options: ["Keep your inventory", "Your stuff waits in a corpse for you (Corpse mod)", "Drop everything, vanilla style"] },
  { id: "pvp", text: "PvP", options: ["Off", "On, but only if both people agree", "On"] },
  { id: "playtime", text: "When do you mostly play?", options: ["Weekday evenings", "Weekends", "Whenever"] },
];

export function parseQuestions(raw: unknown): Question[] {
  if (!Array.isArray(raw)) return [];
  const out: Question[] = [];
  for (const q of raw) {
    if (!q || typeof q !== "object") continue;
    const { id, text, options } = q as Record<string, unknown>;
    if (typeof id !== "string" || !/^[a-z][a-z0-9_-]{0,30}$/.test(id) || typeof text !== "string" || !text.trim()) continue;
    if (!Array.isArray(options) || options.length < 2 || !options.every((o) => typeof o === "string" && o.trim())) continue;
    out.push({ id, text: text.trim(), options: options.map((o) => String(o).trim()) });
  }
  return out;
}
