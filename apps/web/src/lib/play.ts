import { isOutdated, SELF_UPDATING_FROM } from "@/lib/installer-version";
import { MISSING_MODS_TEXT, type GateReason } from "@/shared/join-gate";

// docs/05 "Play from the site". The Play button is a link, deepslate://play, which Windows hands to the
// installed copy of DeepslateWorks.ps1. Pure, so it is tested.

/** The only link the installer accepts (DeepslateWorks.ps1 `Test-PlayLink`). Never built from anything a user typed. */
export const PLAY_LINK = "deepslate://play";

/** How long after the click the page looks at itself: still in front means nothing took the link. */
export const PLAY_WAIT_MS = 2500;

export type LastLaunch = { version: string; at: Date };

/**
 * docs/14 "Play first": the line next to the Play button. `time` is the end of the window, already written out.
 * `selfUpdates`: their copy updates itself when Play is pressed (1.4.0 or later), so an "old installer" only needs Play.
 */
export function joinLine(join: { ok: true; time: string } | { ok: false; reason: GateReason } | null, selfUpdates = false): { text: string; ready: boolean } | null {
  if (!join) return null;
  if (join.ok) return { text: `Ready to join until ${join.time}`, ready: true };
  if (join.reason === "missing mods") return { text: MISSING_MODS_TEXT, ready: false };
  if (join.reason === "old installer" && selfUpdates) return { text: "Press Play before you join: it updates Deepslate Works first.", ready: false };
  if (join.reason === "old installer") return { text: "Download Deepslate Works again from deepslate.dsw.test/install, open it once, then press Play. It keeps itself up to date after that.", ready: false };
  if (join.reason === "wrong version") return { text: "The pack has changed since you pressed Play. Press it again before you join.", ready: false };
  if (join.reason === "stale") return { text: "Press Play before you join: the last time was a while ago.", ready: false };
  return { text: "Press Play before you join. That checks your mods are up to date.", ready: false };
}

/** "Update available": there is a pack, they have launched before, and what they launched is not what is current. */
export function updateAvailable(current: string | null | undefined, last: string | null | undefined): boolean {
  return Boolean(current && last && current !== last);
}

/**
 * What the page concludes when the wait is over. A page that lost focus at any point in the wait was covered by
 * something (the browser's "Open Windows PowerShell?" question, the installer's window), so the link was taken.
 */
export function nothingHappened(s: { visible: boolean; focused: boolean; lostFocus: boolean }): boolean {
  return s.visible && s.focused && !s.lostFocus;
}

/**
 * Is Deepslate Works on their PC, as far as the site knows? Not when their latest report is a successful uninstall
 * (1.5.2): then the Play button offers the download again, as it does the first time.
 */
/**
 * Installer 1.5.3: their copy is too old to update itself (1.3.x and older have no update step), going by their latest
 * report. The Play button then offers the new download instead, until a report from 1.4.0 or later arrives.
 */
export function tooOldToUpdate(latest: { mode: string; outcome: string; installerVersion: string } | null | undefined): boolean {
  if (!latest || !installedNow(latest)) return false;
  return isOutdated(latest.installerVersion, SELF_UPDATING_FROM);
}

export function installedNow(latest: { mode: string; outcome: string } | null | undefined): boolean {
  return !(latest && latest.mode === "uninstall" && latest.outcome === "ok");
}

