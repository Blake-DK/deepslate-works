// docs/07 "The installer updates itself". What the mod list says about the installer the site hands out.
// Pure, so it is tested.

export type InstallerInfo = { version: string; sha256: string; size: number };

const VERSION = /^\d{1,4}(\.\d{1,4}){1,3}$/; // the same shape install.ps1 accepts (Test-Newer)
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * `dist/installer.json` is written by the build next to `installer.zip`. It counts only while it describes the
 * file that is really there: another size or another checksum (a zip copied in by hand, a build cut short) and
 * the mod list names no installer at all, so that no PC is told to fetch something that will not check out.
 */
export function installerInfo(sidecar: unknown, actual: { sha256: string; size: number } | null): InstallerInfo | null {
  if (!actual || !sidecar || typeof sidecar !== "object") return null;
  const s = sidecar as Record<string, unknown>;
  if (typeof s.version !== "string" || !VERSION.test(s.version)) return null;
  if (typeof s.sha256 !== "string" || !SHA256.test(s.sha256)) return null;
  if (s.sha256 !== actual.sha256 || s.size !== actual.size) return null;
  return { version: s.version, sha256: s.sha256, size: actual.size };
}
