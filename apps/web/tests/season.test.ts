import { describe, expect, it } from "vitest";
import { ukDayTime } from "@/lib/uk-time";
import { EVENT_KINDS, KIND_LABEL, PLAYER_KINDS, SEVERITY } from "@/shared/events";
import { seasonCurrent, seasonLine, type SeasonFile } from "@/shared/season";

// docs/34 §5 (W1.3): the words Home and the app's banner show. The arithmetic itself is tested in apps/api
// (tests/seasons.test.ts), against the same shared file.

const s1: SeasonFile = {
  id: "s1", name: "Season 1 · First Blood", startsAt: "2026-11-30T19:00:00Z", endsAt: "2026-12-28T19:00:00Z", icon: "minecraft:netherite_sword",
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
