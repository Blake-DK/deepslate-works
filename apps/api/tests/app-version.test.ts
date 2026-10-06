import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readRequiredApp } from "../src/players/app-version.js";

// Alex, 2026-10-06: a run of Play counts only from the newest app the site hands out. The door reads it from dist/
// as web does, so it never asks for a version the site cannot give.

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const ZIP = Buffer.from("PK zip");
const EXE = Buffer.from("MZ exe 3.5.1");

function dist(files: Record<string, Buffer | string | null>): string {
  const d = mkdtempSync(path.join(tmpdir(), "dist-"));
  for (const [name, body] of Object.entries(files)) if (body !== null) writeFileSync(path.join(d, name), body);
  return d;
}
const sidecar = (exe: object | null = { version: "3.5.1", sha256: sha(EXE), size: EXE.length }) =>
  JSON.stringify({ version: "2.2.0", sha256: sha(ZIP), size: ZIP.length, script: null, exe, builtAt: "2026-10-06T00:00:00Z" });

describe("the app players need", () => {
  it("is the exe the site hands out", async () => {
    expect(await readRequiredApp(dist({ "installer.json": sidecar(), "installer.zip": ZIP, "DeepslateWorks.exe": EXE }))).toBe("3.5.1");
  });
  it("is the script's version when the exe is missing or does not match what installer.json says", async () => {
    expect(await readRequiredApp(dist({ "installer.json": sidecar(), "installer.zip": ZIP, "DeepslateWorks.exe": null }))).toBe("2.2.0");
    expect(await readRequiredApp(dist({ "installer.json": sidecar(), "installer.zip": ZIP, "DeepslateWorks.exe": "MZ something else" }))).toBe("2.2.0");
    expect(await readRequiredApp(dist({ "installer.json": sidecar(null), "installer.zip": ZIP, "DeepslateWorks.exe": EXE }))).toBe("2.2.0");
  });
  it("is nothing when the site has no installer that checks out: nobody is held for it", async () => {
    expect(await readRequiredApp(dist({ "installer.json": null, "installer.zip": ZIP, "DeepslateWorks.exe": EXE }))).toBe("");
    expect(await readRequiredApp(dist({ "installer.json": sidecar(), "installer.zip": "PK another zip", "DeepslateWorks.exe": EXE }))).toBe("");
    expect(await readRequiredApp(dist({ "installer.json": "{not json", "installer.zip": ZIP }))).toBe("");
    expect(await readRequiredApp(path.join(tmpdir(), "no-such-dist"))).toBe("");
  });
});
