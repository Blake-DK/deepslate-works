import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { installerVersion, sha256File } from "../src/build";

describe("installerVersion", () => {
  it("reads the version a script calls itself", () => {
    expect(installerVersion('$PackVersion = "dev"\n$InstallerVersion = "1.4.0"   # notes\n')).toBe("1.4.0");
    expect(installerVersion('  $InstallerVersion = "1.4.0"')).toBeNull(); // only at the start of a line, as install.ps1 looks for it
    expect(installerVersion('$InstallerVersion = "banana"')).toBeNull();
    expect(installerVersion("")).toBeNull();
  });
  it("is in the script that is shipped", async () => {
    const ps1 = await readFile(path.join(__dirname, "../../../installer/install.ps1"), "utf8");
    expect(installerVersion(ps1)).toMatch(/^\d+\.\d+\.\d+$/);
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
