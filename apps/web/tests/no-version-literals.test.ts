import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { forViewer, webBuild, type Versions } from "@/server/versions";

// Versions in the footers (planner, 2026-10-01): no version is ever typed into a footer. This test is the CI check:
// it fails when a version-like number (1.2, 1.2.3, 21.1.252, 0.1.0+abcd1234) appears in the site's footer
// component, the layout that holds it, or the app's footer in DeepslateWorks.ps1.
const VERSION_LITERAL = /(?<![\w.#-])\d+\.\d+(?:\.\d+)*(?:\+[0-9a-f]{4,})?(?![\w.])/g;

function codeOnly(src: string): string {
  // comments may name versions (history); code and markup may not
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/^\s*#.*$/gm, "");
}

export function versionLiterals(src: string): string[] {
  return [...codeOnly(src).matchAll(VERSION_LITERAL)].map((m) => m[0]);
}

describe("no typed versions in a footer", () => {
  it("finds what it is meant to find", () => {
    expect(versionLiterals('<p>Portal 1.8.0 · Pack 0.1.0+02e48265 · NeoForge 21.1.252</p>')).toEqual(["1.8.0", "0.1.0+02e48265", "21.1.252"]);
    expect(versionLiterals("// Portal 1.8.0\nconst a = v.web.version;")).toEqual([]);
    expect(versionLiterals('className="gap-0.5 text-xs"')).toEqual([]);
  });
  it("the site's footer and the layout around it have none", () => {
    for (const f of ["src/components/version-footer.tsx", "src/app/layout.tsx"]) {
      expect([f, versionLiterals(readFileSync(path.join(__dirname, "..", f), "utf8"))]).toEqual([f, []]);
    }
  });
  it("the app's footer has none", () => {
    const ps1 = readFileSync(path.join(__dirname, "..", "..", "..", "installer", "DeepslateWorks.ps1"), "utf8");
    const footer = /# ---- the footer \(versions\)[\s\S]*?# ---- end of the footer/.exec(ps1)?.[0] ?? "";
    expect(footer.length).toBeGreaterThan(0);
    const xaml = /<StackPanel x:Name="Footer"[\s\S]*?<\/StackPanel>/.exec(ps1)?.[0] ?? "";
    expect(xaml.length).toBeGreaterThan(0);
    expect(versionLiterals(footer + xaml)).toEqual([]);
  });
});

describe("the portal's own version", () => {
  it("comes from package.json and what CI stamped; an unstamped image says so", () => {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as { version: string };
    expect(webBuild({ PORTAL_COMMIT: "a5efb56aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", PORTAL_BUILT_AT: "2026-10-01T18:00:00Z" })).toMatchObject({ version: pkg.version, commit: "a5efb56aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", builtAt: "2026-10-01T18:00:00Z" });
    expect(webBuild({ PORTAL_COMMIT: "dev" }).commit).toBeNull();
  });
  it("shows commits and deploy times to admins only", () => {
    const b = webBuild({ PORTAL_COMMIT: "abc1234" });
    const v: Versions = { web: b, api: { ...b, app: "api" }, pack: "x", app: "y", server: null };
    expect(forViewer(v, false).web.commit).toBeNull();
    expect(forViewer(v, false).api?.commit).toBeNull();
    expect(forViewer(v, true).web.commit).toBe("abc1234");
  });
});
