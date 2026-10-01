import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installerVersion, readVersionFile, stampInstallerVersion } from "../src/build";

// Versions in the footers (planner, 2026-10-01): one source each, never typed twice.
const INSTALLER = path.resolve(__dirname, "..", "..", "..", "installer");

describe("the app's version", () => {
  it("is written once, in installer/VERSION, and the script's own line agrees with it", async () => {
    const v = readVersionFile(await readFile(path.join(INSTALLER, "VERSION"), "utf8"));
    const ps1 = await readFile(path.join(INSTALLER, "DeepslateWorks.ps1"), "utf8");
    expect(installerVersion(ps1)).toBe(v);
  });
  it("is stamped into the download from that file", () => {
    expect(installerVersion(stampInstallerVersion('$InstallerVersion = "2.0.1"   # notes\n', "2.0.3"))).toBe("2.0.3");
    expect(stampInstallerVersion('$InstallerVersion = "2.0.1"   # notes\n', "2.0.3")).toBe('$InstallerVersion = "2.0.3"   # notes\n');
    expect(() => readVersionFile("two\n")).toThrow();
    expect(() => stampInstallerVersion("no line", "1.0.0")).toThrow();
  });
});
