import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkBridge, installerVersion, readVersionFile, stampInstallerVersion } from "../src/build";

// Versions in the footers (planner, 2026-10-01): one source each, never typed twice.
const INSTALLER = path.resolve(__dirname, "..", "..", "..", "installer");

describe("the app's version", () => {
  it("is written once, in installer/VERSION (the app's, 3.3.0); the old launcher (2.2) is older, so it hands over", async () => {
    const v = readVersionFile(await readFile(path.join(INSTALLER, "VERSION"), "utf8"));
    const ps1 = await readFile(path.join(INSTALLER, "DeepslateWorks.ps1"), "utf8");
    expect(v).toBe("3.3.0");
    expect(installerVersion(ps1)).toBe("2.2.0");
    expect(() => checkBridge(installerVersion(ps1), v)).not.toThrow();
    expect(() => checkBridge("3.3.0", v)).toThrow(/never offer the exe/);
    expect(() => checkBridge("3.3.1", v)).toThrow();
    expect(() => checkBridge(null, v)).toThrow();
  });
  it("is stamped into the download from that file", () => {
    expect(installerVersion(stampInstallerVersion('$InstallerVersion = "2.0.1"   # notes\n', "2.0.3"))).toBe("2.0.3");
    expect(stampInstallerVersion('$InstallerVersion = "2.0.1"   # notes\n', "2.0.3")).toBe('$InstallerVersion = "2.0.3"   # notes\n');
    expect(() => readVersionFile("two\n")).toThrow();
    expect(() => stampInstallerVersion("no line", "1.0.0")).toThrow();
  });
});
