import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { INSTALLER_SCRIPT, INSTALLER_ZIP_FILES, installerVersion, sha256File } from "../src/build";

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
  it("holds the one script, the bootstrap and a note, and nothing else", async () => {
    expect([...INSTALLER_ZIP_FILES].sort()).toEqual(["DeepslateWorks.ps1", "README.txt", "Setup.bat"]);
    expect(INSTALLER_SCRIPT).toBe("DeepslateWorks.ps1");
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(path.join(__dirname, "../../../installer"))).sort()).toEqual(["DeepslateWorks.ps1", "README.txt", "Setup.bat"]);
  });
  it("Setup.bat runs the one script with -Setup and nothing else", async () => {
    const bat = await readFile(path.join(__dirname, "../../../installer/Setup.bat"), "utf8");
    const commands = bat.split(/\r?\n/).filter((l) => l.trim() && !/^\s*(rem|@echo|echo|title|pause)\b/i.test(l.trim()));
    expect(commands).toEqual(['powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DeepslateWorks.ps1" -Setup']);
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
