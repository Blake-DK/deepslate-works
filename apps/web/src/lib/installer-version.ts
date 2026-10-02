// Which installer ran, against the one the site hands out now (planner, 2026-09-29). Every install and Play
// report carries the version that ran; a report from before installers said so is stored as "unknown" and
// counts as out of date. Pure, so it is tested.

export const UNKNOWN_INSTALLER = "unknown";

const VERSION = /^\d{1,4}(\.\d{1,4}){1,3}$/; // the shape DeepslateWorks.ps1 stamps ($InstallerVersion)

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

/**
 * From this version on an installed copy updates itself on the next Play (docs/07). 1.4.x updates through the
 * install.ps1 bridge in the zip (installer 1.5.3); 1.3.x and older have no update step at all.
 */
export const SELF_UPDATING_FROM = "1.4.0";

/**
 * Has to be downloaded again by hand: out of date and older than 1.4.0, which has no update step. A 1.4.0 or later
 * copy that is behind is simply updated the next time Play is pressed.
 */
export function mustDownloadAgain(version: string | null | undefined, current: string | null | undefined): boolean {
  return isOutdated(version, current) && isOutdated(version, SELF_UPDATING_FROM);
}

/** What the Play window and the install window are told at the end of a run from an old installer. */
export function outdatedNotice(version: string, current: string, site: string): string {
  const which = version === UNKNOWN_INSTALLER ? "an old installer" : `installer ${version}`;
  return `This PC has ${which}; the current one is ${current}. Download Deepslate Works again from ${site}/install and run Setup.bat once. After that it keeps itself up to date.`;
}

/**
 * Which kind of installer a version is (planner, 2026-10-02): 3.x and later the app (DeepslateWorks.exe), 2.x the old
 * launcher (DeepslateWorks.ps1), 1.x the first installer (Setup.bat, cannot update itself to the app). Null when unknown.
 */
export function installerKind(version: string | null | undefined): { kind: "app" | "old launcher" | "old installer"; label: string } | null {
  const m = /^(\d{1,4})(\.\d{1,4}){1,3}$/.exec(version ?? "");
  if (!m) return null;
  const major = Number(m[1]);
  const kind = major >= 3 ? "app" : major === 2 ? "old launcher" : "old installer";
  return { kind, label: `${kind} ${version}` };
}
