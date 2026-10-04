import { describe, expect, it } from "vitest";
import { memoryLine, reportSchema, settingsText } from "@/lib/install-report";

// docs/30 §6 (app 3.5.0): the report's settings block, Admin → Installs' "6 GB for the game (chosen)".
const base = { packVersion: "0.1.0+af76cd89", installerVersion: "3.5.0", mode: "play", outcome: "ok", durationSec: 12, log: "" };

describe("the report's settings", () => {
  it("are taken when the app sends them", () => {
    const r = reportSchema.parse({ ...base, settings: { ramGb: 8, xmxGb: 8, renderDistance: 14, villagers: true } });
    expect(r.settings).toEqual({ ramGb: 8, xmxGb: 8, renderDistance: 14, villagers: true });
  });
  it("and a report without them is still taken (older apps, the minimal ping)", () => {
    expect(reportSchema.parse(base).settings).toBeNull();
    expect(reportSchema.parse({ ...base, minimal: true, settings: null }).settings).toBeNull();
  });
  it("automatic memory is a null ramGb; anything odd is refused, extra keys dropped", () => {
    const r = reportSchema.parse({ ...base, settings: { ramGb: null, xmxGb: 6, renderDistance: null, villagers: false, javaArgs: "-Xmx99G" } });
    expect(r.settings).toEqual({ ramGb: null, xmxGb: 6, renderDistance: null, villagers: false });
    expect(reportSchema.safeParse({ ...base, settings: { xmxGb: 1000 } }).success).toBe(false);
    expect(reportSchema.safeParse({ ...base, settings: { xmxGb: "8" } }).success).toBe(false);
  });
});

describe("the line on Admin → Installs", () => {
  it("says what the game got and whether it was chosen", () => {
    expect(memoryLine({ ramGb: 8, xmxGb: 8, renderDistance: 14, villagers: true })).toBe("8 GB for the game (chosen)");
    expect(memoryLine({ ramGb: null, xmxGb: 6, renderDistance: 12, villagers: false })).toBe("6 GB for the game (automatic)");
    expect(memoryLine({ ramGb: 12, xmxGb: 4, renderDistance: 8, villagers: false })).toBe("4 GB for the game (chosen)"); // clamped on that PC
    expect(memoryLine(null)).toBeNull();
    expect(memoryLine({ ramGb: null, xmxGb: null, renderDistance: null, villagers: false })).toBeNull();
  });
  it("and the report page has the rest", () => {
    expect(settingsText({ ramGb: null, xmxGb: 6, renderDistance: 12, villagers: true })).toBe("Settings: 6 GB for the game (automatic), render distance 12, prisoner villagers on");
  });
});
