// The change log (Alex, 2026-10-04): what changed for players, deploy by deploy. After a deploy the bot adds every
// entry it has not posted yet as a reply in the one forum post "Change log" in season-updates (discord/announcer.ts).
//
// Add an entry, at the end, with every dev → main pull request that changes something a player can see. Plain
// English, British spelling, for the friend who has never played modded. An entry's id never changes once deployed:
// it is how the bot knows the entry has been posted. A deploy without a new entry posts nothing.
//
// Planner, 2026-10-09: an entry is posted only once the change is really live for players: deployed, synced, loaded
// by the server and its live check passed; not at merge. So a new entry goes in without `live`, and a later commit
// sets `live: true` once the live check has passed; the deploy after that posts it. Without it the bot never sees it.

export type Change = { id: string; date: string; lines: string[]; live?: true };

/** What the bot may post: only entries marked live (liveChanges(CHANGES) in server.ts). */
export function liveChanges(all: Change[]): Change[] {
  return all.filter((c) => c.live === true);
}

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
  {
    id: "2026-10-06-app-home",
    date: "2026-10-06",
    lines: [
      "Deepslate Works (the app) opens a little taller, and each step on the Play tab takes one line, so the list fits without scrolling.",
      "The pinned news on the Play tab has a box of its own, in bigger text, and shows the whole message. Click it to open it on the site; news about a vote opens the Votes page.",
      "The Log tab shows lines that went fine in green. Red is only for something that went wrong.",
    ],
  },
  {
    id: "2026-10-06-app-readable",
    date: "2026-10-06",
    lines: [
      "Some text on the app's Play tab was black on a dark box and hard to read, the pinned news among it. It is light now, like the rest.",
      "The pinned news always shows the whole message. A long one scrolls inside its box.",
      "Pressing Play while there is a vote to answer takes you to the vote. Once you've answered everything, the game starts by itself.",
    ],
  },
  {
    id: "2026-10-06-app-no-scrolling",
    date: "2026-10-06",
    lines: ["Nothing on the app's Play tab needs scrolling any more: the window grows to show the whole pinned news and every step, as far as your screen allows."],
  },
  {
    id: "2026-10-07-security-tune-up",
    date: "2026-10-07",
    lines: [
      "Discord sign-in works again. Discord changed something on their side yesterday evening, and signing in with Discord failed until this morning. If you were already signed in, you were not affected.",
      "We ran a full security review of the site and the server this week and have started shipping what it found. None of it changes how you play.",
      "Tighter checks on who can do admin things: the part of the system that talks to the game server now checks an admin's role for itself.",
      "Each part of the site now only holds the keys it needs for its own job.",
      "Our services now run with fewer system permissions than before.",
      "Admin authenticator codes are protected with their own separate key.",
      "The site refuses oversized requests and has one fewer public feature that nobody used.",
      "Our build and deploy pipeline is locked to exact, known versions of the tools it uses, and each deploy now checks that its own setup has not been tampered with before it runs.",
      "More is on the way: signed launcher updates and encrypted off-site backups.",
    ],
  },
  {
    id: "2026-10-07-build-designer",
    date: "2026-10-07",
    lines: [
      "New buildings are on the way. The site now has a build designer for Alex: a building described in words is drawn from every side, changed on request and kept when it is right.",
      "A build's name can now be written any way you like (\"Boss Temple\" becomes boss_temple), and a design carries on by itself while the page is closed.",
    ],
  },
  {
    id: "2026-10-07-countries-admins-only",
    date: "2026-10-07",
    lines: ["Which country you play from is now seen only by you and the admins: the Countries card on Stats is for admins, and other players no longer see it on your page."],
  },
  {
    id: "2026-10-08-entrance-room",
    date: "2026-10-08",
    live: true, // posted 2026-10-09 07:24 UTC, before the rule above; marked so it is not lost
    lines: [
      "The sign-in book in the entrance room opens again with a right-click. The claims mod was refusing it.",
      "Waiting in the entrance room for the first time, the sign-in book is now the only thing you carry. The starter kit (backpack, tools, bread, torches and a bed) arrives when you are let into the world, once.",
      "If you have played before and are asked to wait in the room again, everything you carry stays as it is.",
    ],
  },
  {
    id: "2026-10-09-app-extras-readable",
    date: "2026-10-09",
    lines: [
      "On the app's Extras tab, the \"On\" beside each extra and the shader choices (None, Light, Full) were black on the dark card and hard to read. They are light now, with the app's own boxes instead of white ones. The Allow / Not now choices on permission questions got the same fix.",
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
