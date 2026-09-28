import { describe, expect, it } from "vitest";
import { diffLocks, type LockFile, type LockEntry } from "../src/lock";

const entry = (slug: string, versionId: string, versionNumber = versionId): LockEntry => ({
  slug, name: slug, projectId: "p-" + slug, versionId, versionNumber, versionType: "release", filename: `${slug}.jar`, url: "https://cdn/x.jar",
  sha512: "0", sha1: "0", size: 1, side: "both", requiredBy: [],
});
const lock = (files: LockEntry[], neoforge = "21.1.200"): LockFile => ({ generatedAt: "", minecraft: "1.21.1", neoforge, hash: "h", files, configs: [] });

describe("diffLocks", () => {
  it("reports added, removed, changed and neoforge bumps", () => {
    const prev = lock([entry("a", "1"), entry("b", "1"), entry("c", "1")]);
    const next = lock([entry("a", "1"), entry("b", "2"), entry("d", "1")], "21.1.201");
    const d = diffLocks(prev, next);
    expect(d.added.map((x) => x.slug)).toEqual(["d"]);
    expect(d.removed.map((x) => x.slug)).toEqual(["c"]);
    expect(d.changed).toEqual([{ slug: "b", from: "1", to: "2" }]);
    expect(d.neoforge).toEqual({ from: "21.1.200", to: "21.1.201" });
  });
  it("treats no previous lock as all-added", () => {
    const d = diffLocks(null, lock([entry("a", "1")]));
    expect(d.added).toHaveLength(1);
    expect(d.neoforge).toBeUndefined();
  });
});
