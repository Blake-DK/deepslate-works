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
  {
    id: "2026-10-04-placard-recipe",
    date: "2026-10-04",
    lines: ["A coloured placard can be made plain again: craft it with white dye. That recipe was broken until now."],
  },
];

export const CHANGELOG_TITLE = "Change log";
export const CHANGELOG_OPENER = "What's new on the site and the server. Every update adds a reply here, newest at the bottom.";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Discord takes 2000 characters in one message and refuses a longer one outright. */
export const DISCORD_MAX = 2000;
/** The last line of an entry that did not fit. The test over CHANGES fails on it, so a real entry never ends this way. */
export const CHANGE_CUT = "… and more: this update was too long for one message.";

/** One entry as a Discord message: the date in bold, a bullet per line. Too long for one message: cut at a line break. */
export function changeText(c: Change): string {
  const [y, m, d] = c.date.split("-").map(Number);
  const lines = [`**${d} ${MONTHS[(m ?? 1) - 1]} ${y}**`, ...c.lines.map((l) => `• ${l}`)];
  const whole = lines.join("\n");
  if (whole.length <= DISCORD_MAX) return whole;
  const kept: string[] = [];
  let size = CHANGE_CUT.length;
  for (const l of lines) {
    if (size + l.length + 1 > DISCORD_MAX) break;
    kept.push(l);
    size += l.length + 1;
  }
  return [...kept, CHANGE_CUT].join("\n");
}
