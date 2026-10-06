// SHARED FILE: apps/web/src/shared/ and apps/api/src/shared/ hold identical copies (a test compares them).
// Edit the copy in apps/web, then `cp apps/web/src/shared/*.ts apps/api/src/shared/`.
//
// docs/07 "Updates". What the mod list says about the installer the site hands out. Pure, so it is tested.

/**
 * `version`, `sha256`/`size`: the PowerShell installer and its zip (what 1.4.x-2.x copies check and update to; since
 * 3.0 that script is the bridge that moves a PC to the exe). `script`: DeepslateWorks.ps1 on its own, which an
 * installed 1.5.0-2.x copy fetches. `exe`: Deepslate Works 3.0, DeepslateWorks.exe (built by CI on windows), which a
 * 3.x copy and the bridge fetch, and the one the site's download button gives. `current`: the newest of them, what
 * "out of date" is measured against. `download`: the file the download button gives.
 */
export type InstallerInfo = {
  version: string;
  sha256: string;
  size: number;
  script: { sha256: string; size: number } | null;
  exe: { version: string; sha256: string; size: number } | null;
  current: string;
  download: "DeepslateWorks.exe" | "installer.zip";
  downloadSize: number;
};
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
export function installerInfo(sidecar: unknown, zip: Actual | null, script: Actual | null = null, exeFile: Actual | null = null): InstallerInfo | null {
  if (!zip || !sidecar || typeof sidecar !== "object") return null;
  const s = sidecar as Record<string, unknown>;
  if (typeof s.version !== "string" || !VERSION.test(s.version)) return null;
  if (!same(s, zip)) return null;
  // 3.0: the exe counts only when it is on disk as described and has a version of its own
  const e = s.exe && typeof s.exe === "object" ? (s.exe as Record<string, unknown>) : null;
  const exe = e && typeof e.version === "string" && VERSION.test(e.version) && same(e, exeFile) ? { version: e.version, sha256: exeFile!.sha256, size: exeFile!.size } : null;
  return {
    version: s.version,
    sha256: zip.sha256,
    size: zip.size,
    script: same(s.script, script) ? { sha256: script!.sha256, size: script!.size } : null,
    exe,
    current: exe ? exe.version : s.version,
    download: exe ? "DeepslateWorks.exe" : "installer.zip",
    downloadSize: exe ? exe.size : zip.size,
  };
}

/** What the mod list says about installers to whoever asks (planner, 2026-10-02, the hand-over to the app). */
export type InstallerOffer = InstallerInfo & {
  /** The app, offered to the old launcher under a name only 2.2.0 reads: 2.2.0 asks first (Update now / Not now). */
  app?: InstallerInfo["exe"];
  /** The app players need to join (`requiredInstaller`): above 2.2.0, so 2.2.0 offers no "Not now". */
  minimum?: string | null;
};

/** The app says who it is ("DeepslateWorks/3.0.0 (Windows)"); the PowerShell launcher sends PowerShell's own agent. */
export const isApp = (userAgent: string | null | undefined): boolean => /^DeepslateWorks\/\d/.test(userAgent ?? "");

/**
 * The app gets `exe` (its own self-update). The old launcher never does: 2.1.3 moves to the app the moment it sees
 * `exe`, without asking, so it is shown no exe, updates itself to the current script (2.2.0) and that one asks. 2.2.0
 * finds the app under `app`, with the version players need to join (`minimum`), which takes away its "Not now".
 */
export function installerFor(info: InstallerInfo | null, userAgent: string | null | undefined): InstallerOffer | null {
  if (!info) return null;
  if (isApp(userAgent)) return info;
  return { ...info, exe: null, app: info.exe, minimum: requiredInstaller(info) || null };
}

/**
 * The installer a run of Play has to come from to let anyone in (Alex, 2026-10-06): always the newest the site hands
 * out, so every PC updates before it plays. Pressing Play updates it (the app by itself, an older launcher through
 * the 2.2.0 bridge, which may no longer say "Not now"). "" when the site has no installer that checks out: there is
 * nothing to update to, and nobody is held for it.
 */
export function requiredInstaller(info: Pick<InstallerInfo, "current"> | null | undefined): string {
  return info?.current ?? "";
}

/**
 * The app version the footers show (planner, 2026-10-01; fixed 2026-10-02): the newest of the download, which since
 * 3.0 is the app (DeepslateWorks.exe), not the old launcher's script version (2.2.0) that `version` still holds.
 */
export function shownAppVersion(info: Pick<InstallerInfo, "version" | "current"> | null | undefined): string | null {
  return info ? info.current || info.version || null : null;
}
