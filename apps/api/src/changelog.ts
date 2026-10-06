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
  {
    id: "2026-10-05-review-fixes",
    date: "2026-10-05",
    lines: [
      "Pressing Play while the server is asleep: the line under the button now follows the server until it is ready, instead of staying on \"Waking the server\".",
      "If you were waiting in the entrance room and the server was slow to let you through, it now tries again by itself. No more leaving and joining again.",
      "A hiccup at Discord while you sign in no longer signs you out everywhere. The page says Discord did not answer; try again in a minute.",
      "Mods & vote → Results shows the last finished vote while a new one is open, and no longer shows an error page before the first vote has closed.",
      "The site's install help now talks about Deepslate Works.exe, not the old zip and Setup.bat.",
      "Play time per day on a player's page was counted twice in places. It adds up now.",
    ],
  },
  {
    id: "2026-10-05-maps-fixed",
    date: "2026-10-05",
    lines: ["This morning the game stopped at \"Error loading mods\" (the two map mods wanted a newer claims mod). Fixed: press Play again and it loads."],
  },
  {
    id: "2026-10-05-mod-videos",
    date: "2026-10-05",
    lines: ["Eight more mods on Mods & vote → Mod list have a video now, so you can see what they do."],
  },
  {
    id: "2026-10-06-newest-app",
    date: "2026-10-06",
    lines: [
      "You now need the newest Deepslate Works to join. You don't have to do anything: pressing Play updates it first, then opens the game.",
      "If it can't update, it now stops and says so instead of starting an old version the server would turn away. Press Play to try again.",
      "Still on the old Deepslate Works launcher? Pressing Play moves you to the new app straight away; \"Not now\" is gone.",
    ],
  },
  {
    id: "2026-10-06-discord-votes",
    date: "2026-10-06",
    lines: [
      "Voting with the buttons on a vote's post here counts as your vote on the site too. You don't need to vote twice. The reply after you press says which account it was saved to and, if the vote was needed before playing, whether you can join now.",
      "The site shows \"You voted in Discord\" on those votes.",
    ],
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
