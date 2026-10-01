import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintManifest } from "../src/lint";
import { lintExtras } from "../src/extras";
import { isPlayerFacing } from "../src/schema";

// The Mods guide (/mods) is generated from mods.json and extras.json (planner, 2026-10-01). These run on the real
// files, so CI fails when a switched-on, player-facing mod or an extra has no howTo.
const MODPACK = path.resolve(__dirname, "..", "..", "..", "modpack");

describe("the pack's own files", () => {
  it("mods.json lints clean, with a howTo for every switched-on player-facing mod", async () => {
    const { manifest, issues } = lintManifest(JSON.parse(await readFile(path.join(MODPACK, "mods.json"), "utf8")));
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    const missing = manifest!.mods.filter((m) => isPlayerFacing(m) && !m.howTo).map((m) => m.slug);
    expect(missing).toEqual([]);
  });
  it("extras.json lints clean, with a howTo for every extra", async () => {
    const { extras, errors } = lintExtras(JSON.parse(await readFile(path.join(MODPACK, "extras.json"), "utf8")));
    expect(errors).toEqual([]);
    expect(extras!.extras.filter((x) => !x.howTo).map((x) => x.id)).toEqual([]);
  });
});
