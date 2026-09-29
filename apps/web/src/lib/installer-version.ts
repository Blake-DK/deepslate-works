// Which installer ran, against the one the site hands out now (planner, 2026-09-29). Every install and Play
// report carries the version that ran; a report from before installers said so is stored as "unknown" and
// counts as out of date. Pure, so it is tested.

export const UNKNOWN_INSTALLER = "unknown";

const VERSION = /^\d{1,4}(\.\d{1,4}){1,3}$/; // the shape install.ps1 stamps ($InstallerVersion)

/** What a report says about its installer, as it is stored: a version, or "unknown". */
export function reportedVersion(v: string | null | undefined): string {
  const t = (v ?? "").trim();
  return VERSION.test(t) ? t : UNKNOWN_INSTALLER;
}

/** -1, 0 or 1 like a sort; null when either is not a version. "1.4" is "1.4.0". */
export function compareVersions(a: string, b: string): number | null {
  if (!VERSION.test(a) || !VERSION.test(b)) return null;
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Out of date: older than `current`, or not known at all. With no current installer (the download is missing or
 * does not check out) nothing is called out of date: there is nothing better to send anyone to.
 */
export function isOutdated(version: string | null | undefined, current: string | null | undefined): boolean {
  if (!current || !VERSION.test(current)) return false;
  const c = compareVersions(reportedVersion(version), current);
  return c === null || c < 0;
}

/** What the Play window and the install window are told at the end of a run from an old installer. */
export function outdatedNotice(version: string, current: string, site: string): string {
  const which = version === UNKNOWN_INSTALLER ? "an old installer" : `installer ${version}`;
  return `This PC has ${which}; the current one is ${current}. Download it again from ${site}/install before your next run, and run Setup.bat once.`;
}
