import { describe, expect, it } from "vitest";
import { build, parseLaunchLine, stamped } from "../src/status/versions.js";

// Versions in the footers (planner, 2026-10-01): api's own, and what the server runs.
describe("versions", () => {
  it("reads Minecraft and NeoForge from ModLauncher's first line (this server, 2026-10-01)", () => {
    expect(parseLaunchLine("[01Oct2026 17:31:37.112] [main/INFO] [cpw.mods.modlauncher.Launcher/MODLAUNCHER]: ModLauncher running: args [--launchTarget, forgeserver, --fml.neoForgeVersion, 21.1.252, --fml.fmlVersion, 4.0.44, --fml.mcVersion, 1.21.1, --fml.neoFormVersion, 20240808.144430]")).toEqual({ minecraft: "1.21.1", neoforge: "21.1.252" });
    expect(parseLaunchLine("Starting minecraft server")).toBeNull();
  });
  it("takes the commit and build time CI stamped, and none from an unstamped image", () => {
    expect(build({ PORTAL_COMMIT: "a5efb56", PORTAL_BUILT_AT: "2026-10-01T18:00:00Z" } as NodeJS.ProcessEnv)).toMatchObject({ app: "api", commit: "a5efb56", builtAt: "2026-10-01T18:00:00Z" });
    expect(build({} as NodeJS.ProcessEnv).commit).toBeNull();
    expect(stamped("dev")).toBeNull();
    expect(build({} as NodeJS.ProcessEnv).version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
