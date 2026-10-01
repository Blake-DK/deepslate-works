import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildInstaller, INSTALLER_BRIDGE, INSTALLER_SCRIPT, INSTALLER_ZIP_FILES, installerVersion, sha256File } from "../src/build";
import { openZip } from "../src/zip";
import type { Manifest } from "../src/schema";
import type { LockFile } from "../src/lock";

describe("installerVersion", () => {
  it("reads the version a script calls itself", () => {
    expect(installerVersion('$PackVersion = "dev"\n$InstallerVersion = "1.4.0"   # notes\n')).toBe("1.4.0");
    expect(installerVersion('  $InstallerVersion = "1.4.0"')).toBeNull(); // only at the start of a line, as the script looks for it
    expect(installerVersion('$InstallerVersion = "banana"')).toBeNull();
    expect(installerVersion("")).toBeNull();
  });
  it("is in the script that is shipped", async () => {
    const ps1 = await readFile(path.join(__dirname, "../../../installer/DeepslateWorks.ps1"), "utf8");
    expect(installerVersion(ps1)).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// Installer 1.4.0 and before ended at "Finding Java 21" on any PC with a java on PATH: java says its version on
// stderr, and in Windows PowerShell 5.1 `& java -version 2>&1` under $ErrorActionPreference = "Stop" is an error
// that ends the script. What the script does instead is checked by its own self test (DeepslateWorks.ps1 -SelfTest).
describe("the script that is shipped", () => {
  const code = async () => (await readFile(path.join(__dirname, "../../../installer/DeepslateWorks.ps1"), "utf8")).split(/\r?\n/).filter((l) => !/^\s*#/.test(l));
  it("sends no command's stderr through 2>&1", async () => {
    const lines = (await code()).filter((l) => l.includes("2>&1") && !l.includes("[regex]::Matches") && !/^\s*Check "/.test(l)); // the self test looks for it, and says so
    expect(lines).toEqual([]);
  });
  it("asks java for its version through a process of its own, in both places", async () => {
    const lines = await code();
    expect(lines.filter((l) => /-version\b/.test(l) && !/^\s*\$psi\.Arguments = "-version"$/.test(l))).toEqual([]);
    expect(lines.filter((l) => /Get-JavaVersionText \$/.test(l)).length).toBeGreaterThanOrEqual(3); // the one on PATH, the one chosen, the self test
    expect(lines.some((l) => l.includes("RedirectStandardError = $true"))).toBe(true);
  });
  it("is 1.5.0 or newer", async () => {
    const [a, b, c] = (installerVersion((await readFile(path.join(__dirname, "../../../installer/DeepslateWorks.ps1"), "utf8"))) ?? "0.0.0").split(".").map(Number);
    expect(a! * 1_000_000 + b! * 1_000 + c!).toBeGreaterThanOrEqual(1_005_000);
  });
});

// Installer 1.5.0 (planner): one script does everything; Setup.bat only puts it in place the first time.
describe("the download", () => {
  it("holds the one script, the bootstrap, a note and the 1.4.x bridge, and nothing else", async () => {
    expect([...INSTALLER_ZIP_FILES].sort()).toEqual(["DeepslateWorks.ps1", "README.txt", "Setup.bat", "install.ps1"]);
    expect(INSTALLER_SCRIPT).toBe("DeepslateWorks.ps1");
    expect(INSTALLER_BRIDGE).toBe("install.ps1");
    const { readdir } = await import("node:fs/promises");
    // install.ps1 is made by the build from DeepslateWorks.ps1; it is not a file of its own in the repo
    expect((await readdir(path.join(__dirname, "../../../installer"))).sort()).toEqual(["DeepslateWorks.ps1", "README.txt", "Setup.bat"]);
  });
  // Installer 1.5.3: 1.4.x's update step takes "Setup.bat" and "install.ps1" out of the zip by those names, top level,
  // under 2 MB each, and checks the script's version line. Without install.ps1 no 1.4.x copy can update itself.
  it("is built with Setup.bat, DeepslateWorks.ps1, install.ps1 and README.txt at the top level, install.ps1 the same script", async () => {
    const dist = await mkdtemp(path.join(tmpdir(), "installer-build-"));
    try {
      const m = { name: "Deepslate Works", version: "0.1.0" } as Manifest;
      const lock = { hash: "abcdef0123456789" } as LockFile;
      const zip = await buildInstaller(m, lock, { dist, installer: path.join(__dirname, "../../../installer") }, "https://deepslate.example", () => {});
      const z = openZip(await readFile(zip));
      expect([...z.names].sort()).toEqual(["DeepslateWorks.ps1", "README.txt", "Setup.bat", "install.ps1"]);
      const script = z.read("DeepslateWorks.ps1")!;
      const bridge = z.read("install.ps1")!;
      expect(bridge.equals(script)).toBe(true);
      expect(bridge.equals(await readFile(path.join(dist, "DeepslateWorks.ps1")))).toBe(true);
      expect(script.toString("utf8")).toMatch(/^\$PortalUrl = "https:\/\/deepslate\.example"$/m);
      const version = installerVersion(bridge.toString("utf8"));
      expect(bridge.toString("utf8")).toMatch(new RegExp(`^\\$InstallerVersion = "${version!.replace(/\./g, "\\.")}"`, "m")); // what 1.4.x checks
      for (const name of ["Setup.bat", "install.ps1", "DeepslateWorks.ps1"]) {
        const b = z.read(name)!;
        expect(b.length).toBeGreaterThan(0);
        expect(b.length).toBeLessThan(2 * 1024 * 1024);
      }
      const info = JSON.parse(await readFile(path.join(dist, "installer.json"), "utf8")) as { version: string; sha256: string };
      expect(info.version).toBe(version);
      expect(info.sha256).toBe(await sha256File(zip)); // the zip's, which is what 1.4.x checks
    } finally {
      await rm(dist, { recursive: true, force: true });
    }
  });
  it("Setup.bat runs the one script with -Setup and nothing else, and waits only when it failed (2.0.0: the app's window takes over)", async () => {
    const bat = await readFile(path.join(__dirname, "../../../installer/Setup.bat"), "utf8");
    const commands = bat.split(/\r?\n/).filter((l) => l.trim() && !/^(@echo off|echo\.?|pause|\)|if errorlevel 1 \()$/i.test(l.trim()) && !/^(rem|title)\b/i.test(l.trim()));
    expect(commands).toEqual(['powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DeepslateWorks.ps1" -Setup']);
    expect(bat).toMatch(/if errorlevel 1 \(\r?\n\s*echo\.\r?\n\s*pause\r?\n\)/);
  });
});

describe("sha256File", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
  it("is the SHA-256 of the file", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "installer-test-"));
    const f = path.join(dir, "x.zip");
    await writeFile(f, "deepslate");
    expect(await sha256File(f)).toBe(createHash("sha256").update("deepslate").digest("hex"));
  });
});
