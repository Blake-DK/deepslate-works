// The change log (Alex, 2026-10-04): what changed for players, deploy by deploy. After a deploy the bot adds every
// entry it has not posted yet as a reply in the one forum post "Change log" in season-updates (discord/announcer.ts).
//
// Add an entry, at the end, with every dev → main pull request that changes something a player can see. Plain
// English, British spelling, for the friend who has never played modded. An entry's id never changes once deployed:
// it is how the bot knows the entry has been posted. A deploy without a new entry posts nothing.

export type Change = { id: string; date: string; lines: string[] };

export const CHANGES: Change[] = [
  {
    id: "2026-10-04-invites",
    date: "2026-10-04",
    lines: [
      "An invite link from Alex now gets a friend in even if they are not in this Discord server.",
      "When signing in on the site doesn't work, the page now says why: not in the Discord server, or an invite link that has been used or has run out.",
      "This post is new too: what changes on the site and the server is written here after every update.",
    ],
  },
];

export const CHANGELOG_TITLE = "Change log";
export const CHANGELOG_OPENER = "What's new on the site and the server. Every update adds a reply here, newest at the bottom.";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** One entry as a Discord message: the date in bold, a bullet per line. */
export function changeText(c: Change): string {
  const [y, m, d] = c.date.split("-").map(Number);
  return [`**${d} ${MONTHS[(m ?? 1) - 1]} ${y}**`, ...c.lines.map((l) => `• ${l}`)].join("\n");
}
