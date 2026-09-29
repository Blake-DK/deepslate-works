// docs/05 "Play from the site". The Play button is a link, deepslate://play, which Windows hands to the
// installed copy of install.ps1. Pure, so it is tested.

/** The only link the installer accepts (install.ps1 `Test-PlayLink`). Never built from anything a user typed. */
export const PLAY_LINK = "deepslate://play";

/** How long after the click the page looks at itself: still in front means nothing took the link. */
export const PLAY_WAIT_MS = 2500;

export type LastLaunch = { version: string; at: Date };

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
