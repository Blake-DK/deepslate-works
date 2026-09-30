// docs/07 "Updates". What the mod list says about the installer the site hands out. Pure, so it is tested.

/** `sha256`/`size`: the zip. `script`: DeepslateWorks.ps1 on its own, which an installed copy fetches (1.5.0 on). */
export type InstallerInfo = { version: string; sha256: string; size: number; script: { sha256: string; size: number } | null };
type Actual = { sha256: string; size: number };

const VERSION = /^\d{1,4}(\.\d{1,4}){1,3}$/; // the same shape the script accepts (Test-Newer)
const SHA256 = /^[0-9a-f]{64}$/;

const same = (claimed: unknown, actual: Actual | null): boolean => {
  if (!actual || !claimed || typeof claimed !== "object") return false;
  const c = claimed as Record<string, unknown>;
  return typeof c.sha256 === "string" && SHA256.test(c.sha256) && c.sha256 === actual.sha256 && c.size === actual.size;
};

/**
 * `dist/installer.json` is written by the build next to `installer.zip` and `DeepslateWorks.ps1`. It counts only while
 * it describes the files that are really there: a zip copied in by hand or a build cut short and the mod list names no
 * installer at all; a script that does not match and it names no script, so that no PC is told to fetch something that
 * will not check out.
 */
export function installerInfo(sidecar: unknown, zip: Actual | null, script: Actual | null = null): InstallerInfo | null {
  if (!zip || !sidecar || typeof sidecar !== "object") return null;
  const s = sidecar as Record<string, unknown>;
  if (typeof s.version !== "string" || !VERSION.test(s.version)) return null;
  if (!same(s, zip)) return null;
  return { version: s.version, sha256: zip.sha256, size: zip.size, script: same(s.script, script) ? { sha256: script!.sha256, size: script!.size } : null };
}
