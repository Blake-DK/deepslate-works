import { describe, expect, it } from "vitest";
import { ukDayTime } from "@/lib/uk-time";
import { EVENT_KINDS, KIND_LABEL, PLAYER_KINDS, SEVERITY } from "@/shared/events";
import { seasonCurrent, seasonFileSchema, seasonLine, type SeasonFile } from "@/shared/season";
import { seasonGuide } from "@/lib/season-guide";
import { readFileSync } from "node:fs";
import path from "node:path";

// docs/34 §5 (W1.3): the words Home and the app's banner show. The arithmetic itself is tested in apps/api
// (tests/seasons.test.ts), against the same shared file.

const s1: SeasonFile = {
  id: "s1", name: "Season 1 · First Blood", startsAt: "2026-11-30T19:00:00Z", endsAt: "2026-12-28T19:00:00Z", icon: "minecraft:netherite_sword", groupRadius: 48,
  bosses: [{ id: "frostmaw", title: "Frostmaw", entity: "mowziesmobs:frostmaw", tier: 1, points: 10, where: "Snowy biomes", hint: "" }],
  trials: [{ id: "iron", title: "Iron Week", opensAt: "2026-12-04T19:00:00Z", points: 5, solo: true, hint: "", icon: "minecraft:paper" }],
  finale: { at: "2026-12-26T20:00:00Z", title: "The Dragon, together", boss: "frostmaw" },
};
const at = (iso: string) => ukDayTime(new Date(iso));

describe("the season's line", () => {
  it("gives UK days and hours, in winter and in summer", () => {
    expect(ukDayTime(new Date("2026-11-30T19:00:00Z"))).toBe("Mon 30 Nov, 19:00");
    expect(ukDayTime(new Date("2027-06-28T18:00:00Z"))).toBe("Mon 28 Jun, 19:00");
  });

  it("before, during and after", () => {
    expect(seasonLine(seasonCurrent(s1, "upcoming", new Date("2026-11-25T12:00:00Z")), at)).toBe("Season 1 · First Blood opens Mon 30 Nov, 19:00.");
    expect(seasonLine(seasonCurrent(s1, "running", new Date("2026-12-01T12:00:00Z")), at)).toBe("Season 1 · First Blood · week 1 of 4, 27 days left. Next: Iron Week, Fri 4 Dec, 19:00.");
    expect(seasonLine(seasonCurrent(s1, "running", new Date("2026-12-28T12:00:00Z")), at)).toBe("Season 1 · First Blood · week 4 of 4, ends today. This week's trial: Iron Week.");
    expect(seasonLine(seasonCurrent(s1, "ended", new Date("2026-12-29T12:00:00Z")), at)).toBe("Season 1 · First Blood is over. The results are on the Season page.");
    expect(seasonLine(seasonCurrent(s1, null, new Date()), at)).toBeNull();
  });

  it("SEASON is an event kind players see", () => {
    expect(EVENT_KINDS).toContain("SEASON");
    expect(PLAYER_KINDS).toContain("SEASON");
    expect(SEVERITY.SEASON).toBe("player");
    expect(KIND_LABEL.SEASON).toBe("Season");
  });
});

describe("the guide's Season section (docs/20 §7)", () => {
  const real = seasonFileSchema.parse(JSON.parse(readFileSync(path.join(__dirname, "../../../modpack/seasons/s1.json"), "utf8")));

  it("is written from the real Season 1 file: the ladder, the 48 blocks, the Frontier and its wipe, the finale", () => {
    const text = seasonGuide(real, "running", at);
    expect(text.startsWith("## The season\n")).toBe(true);
    expect(text).toContain("**Season 1 · First Blood** runs from Mon 30 Nov, 19:00 to Mon 28 Dec, 19:00, UK time.");
    expect(text).toContain(`There are ${real.bosses.length} on the ladder, in 3 tiers`);
    expect(text).toContain("everyone within 48 blocks of you");
    expect(text).toContain("**The Frontier is wiped when the season ends.**");
    expect(text).toContain(`- **The finale.** ${real.finale!.title}: ${at(real.finale!.at)}.`);
    expect(text).toContain("50 boss kills between us");
  });

  it("says only what the season has, and after the end only where the results are", () => {
    const plain = seasonGuide(s1, "upcoming", at);
    expect(plain).not.toContain("Frontier");
    expect(plain).not.toContain("Together");
    expect(plain).toContain("There is 1 on the ladder.");
    const over = seasonGuide(real, "ended", at);
    expect(over).toContain("ended on Mon 28 Dec, 19:00");
    expect(over).not.toContain("Bosses");
  });
});
