// The download log: what is written down when somebody fetches something from the site. Pure, so it is tested.
//
// What the site hands out itself is the installer, the settings that go with the pack, and the mod list. The
// mods' own files come from Modrinth, straight to the player's PC; the site never sees those downloads. The mod
// list is what names them, so a fetch of the mod list is the nearest thing to "the mods were downloaded".

export type Via = "site" | "installer" | "key";
export type Refusal = "not_live" | "server_offline";

/** Signed in on the site, the installer with its token, or the pack's key (no person behind it). */
export function viaOf(hasToken: boolean, hasKey: boolean): Via {
  return hasKey ? "key" : hasToken ? "installer" : "site";
}

/** With the key nobody is signed in: the line in the log stands by itself. */
export const actionOf = (what: "file" | "modlist", via: Via) => `download.${what}${via === "key" ? ".key" : ""}`;

/** The same person fetching the same thing again within this long is the same download (browsers ask twice, the installer asks for the mod list twice in one run). */
export const SAME_DOWNLOAD_MS = 2 * 60_000;

export const mb = (bytes: number) => (bytes < 1_048_576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`);
