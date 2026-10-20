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
//
// docs/53 D2, as Alex settled it on 2026-10-12: every entry is a reply in "Change log". An entry with a `title` (1 to 90
// characters) is a big update that changes the game: the title leads its reply in bold and it tags @Minecraft (D1).
// Give a title only to those; site and look changes and bug fixes go without one and ping nobody. `noPing`: an entry
// that has pinged everyone once already, posted again without the tag. No entry names a season's mods or bosses (the test reads them
// from mods.json and the season files).

export type Change = { id: string; date: string; title?: string; lines: string[]; live?: true; noPing?: true };

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
  {
    // planner 2026-10-09: no mod and no season named; the pack tidy and app 3.6.1 as one entry. Set `live: true` only
    // after the live check (the rule above).
    id: "2026-10-09-reopening",
    date: "2026-10-09",
    live: true,
    lines: ["A small pack update, a tidy-up of the world and a new version of the app. Press Play as usual."],
  },
  {
    // AMP state numbers (docs/47 §5.7), Maintenance (docs/48 Part B), the tab strips. Set `live: true` only after the
    // live check (the rule above).
    id: "2026-10-10-server-words-maintenance",
    date: "2026-10-10",
    live: true,
    lines: [
      "The site and the app now say the right thing when the server goes to sleep, stops or restarts. Before, a server going to sleep showed as \"Stopping\" and a restart could show as \"Asleep\".",
      "When the server is down for maintenance, the site and the app now say so. Anyone playing is sent off with that message, and if you join while it lasts you wait in the entrance room and are let in as soon as it's over.",
      "On Windows, the rows of tabs on the site no longer show a small scrollbar at their end.",
    ],
  },
  {
    // Players & stats: whole rows and every name open the player's page. Set `live: true` only after the live check
    // (the rule above).
    id: "2026-10-11-player-pages",
    date: "2026-10-11",
    live: true,
    lines: ["On Players, click anywhere on someone's row to open their page. On Stats, every player's name now opens their page too."],
  },
  {
    // The Mods guide by type (docs/52). Set `live: true` only after the live check (the rule above).
    id: "2026-10-11-mods-guide-by-type",
    date: "2026-10-11",
    lines: [
      "The Mods guide is now split up by type: getting around, mining, storage, building, factories, farming and more, so you can find the mods for what you want to do.",
      "Under the search box, a row of links takes you straight to each section. When you search, sections with nothing that matches are hidden, and so are their links.",
    ],
  },
  {
    // docs/53 D3 post 1. First posted 2026-10-12 09:50 UTC as "2026-10-12-power-and-gear-coming", a forum post of its
    // own, with the ping. Alex: it belongs in Change log; the post was deleted by hand and the entry goes in again under
    // a new id (so the bot posts it once more), without a second ping.
    id: "2026-10-12-power-and-gear-coming-in-log",
    date: "2026-10-12",
    title: "Power and gear update incoming",
    live: true,
    noPing: true,
    lines: [
      "You told us there's no reason to build past a starter generator and nothing beats diamond. Fair. Here's what's coming.",
      "The quarry will need real power. A small generator will still run it, just slowly. Full speed means building a proper power setup.",
      "Mekanism is coming in: generators, energy storage, ore processing, fission and fusion reactors and the MekaSuit, a full set of power armour with a jetpack. It's heavy on weaker PCs.",
      "Its ores will appear in old ground the first time anyone goes there. No world reset.",
      "Both get tried on a test copy of the world first. We'll post here when they land.",
    ],
  },
  {
    // docs/53 D3 post 2, rewritten for the Moon (docs/55 M6): post 1 said the ores would appear in old ground. Set
    // `live: true` only after the live check of docs/53 A, B and E1 and docs/55 (the rule above).
    id: "2026-10-12-power-and-gear-landed",
    date: "2026-10-12",
    live: true,
    title: "Power and gear update is live",
    lines: [
      "The quarry now needs real power: one small generator only crawls. When its storage is full it stops, and starts again by itself when there's room.",
      "Mekanism is in: generators, reactors and the MekaSuit power armour. Press Play to update.",
      "Its ores aren't in the old ground after all: the main world was left as it was. They're on Ashmoon, a new moon of its own where everything can be mined, and osmium is found only there.",
      "To get there, use the portal near spawn at -444, 587. To build your own: a frame of smooth basalt shaped like a nether portal, 4 wide and 5 tall (mine it from the shell of an amethyst geode, or smelt Nether basalt), then right-click inside it with an eye of ender. Walk back through to come home.",
      "Gravity is low, the night never ends and monsters are about. Below y 30 the air is poisonous: craft a gas mask first (leather, 2 string, charcoal and a glass pane).",
    ],
  },
  {
    // docs/59: two flower mods, straight into the pack. Set `live: true` only after the live check (the rule above).
    id: "2026-10-14-flowers",
    date: "2026-10-14",
    live: true,
    lines: [
      "Two new mods for gardens: Serene Shrubbery (flowers in lots of colours; plant two or three side by side and new colours appear over time) and Wilder Flowers (wildflowers, clover patches and flower garlands you can wear or hang up). The wildflowers grow in land nobody has explored yet. Press Play to update.",
    ],
  },
  {
    // docs/61 §7's update post, in its words (Alex, 2026-10-14: everything on dev goes live).
    id: "2026-10-14-gun-balance",
    date: "2026-10-14",
    live: true,
    title: "Guns rebalanced",
    lines: [
      "Guns have been rebalanced: all gun damage is lower, and the stronger guns now need steel, the biggest ones netherite and refined obsidian.",
      "Ammo crafts give half as many rounds. Cannon shells do half the damage to mobs.",
      "Guns you already own keep working, at the new damage.",
    ],
  },
  {
    // Alex, 2026-10-14: the horror mobs on Ashmoon, kept after the trial on the test server.
    id: "2026-10-14-ashmoon-monsters",
    date: "2026-10-14",
    live: true,
    title: "New monsters on Ashmoon",
    lines: [
      "The Moon now has a name: Ashmoon. And it's a lot less friendly.",
      "Giant insects and spiders hunt there now, with bosses that come with thunder. Mutant zombies, skeletons, creepers and endermen roam too: bigger, tougher and with new attacks. They only live on Ashmoon, never in the main world.",
      "There are more monsters on Ashmoon than before, so bring light, armour and a good weapon.",
      "Spiders everywhere now climb walls and ceilings like real ones: a roof won't keep them off, but light and a closed door still do.",
      "Press Play to update. It's a bigger download than usual.",
    ],
  },
  {
    // app 3.6.2: render distance up to 32. Set `live: true` only once 3.6.2 is what the site hands out and its live
    // check passed (the rule above).
    id: "2026-10-12-app-3-6-2-render-distance",
    date: "2026-10-12",
    live: true,
    lines: ["In the app's Settings tab, render distance now goes up to 32 chunks. It stopped at 16 before, below the 20 the server shows, so you could never see as far as the server lets you."],
  },
  {
    // Macaw's Holidays, straight into the pack (Alex, 2026-10-14). Set `live: true` only after the live check (the
    // rule above).
    id: "2026-10-14-macaws-holidays",
    date: "2026-10-14",
    live: true,
    lines: [
      "New mod for decorating: Macaw's Holidays. Christmas trees, string lights, garlands, presents, stockings and candy canes, plus carved pumpkins and cobwebs for Halloween. All made at a crafting table from everyday things. Press Play to update.",
    ],
  },
  {
    // The pack's keys (Alex, 2026-10-14; app 3.6.6). Set `live: true` once 3.6.6 is out and a Play has set the keys.
    id: "2026-10-14-pack-keys",
    date: "2026-10-14",
    live: true,
    lines: [
      "Deepslate Works now shows a quick guide the first time you open it after this update: what each tab does, and the new keys.",
      "Some keys did two things at once. Now each does one. Press Play to get the new keys. Any key you had already changed yourself stays as you set it.",
      "The backpack you wear opens with ` (top left, under Esc, next to 1). B is only for map waypoints now.",
      "Mute your microphone with N. M only opens the map now.",
      "R only reloads your gun now, not the shaders too. G, H, C and Z are only for guns (fire mode, inspect, crawl, attachments), and V is only voice chat. Gun melee and scope zoom have no key; set one in Options, Controls if you want them.",
    ],
  },
  {
    // Ashmoon's air is radiation now, stronger the deeper you go (Alex, 2026-10-14). Set `live: true` only after the
    // live check (the rule above).
    id: "2026-10-14-ashmoon-radiation",
    date: "2026-10-14",
    title: "Ashmoon is radioactive",
    lines: [
      "The bad air below y 30 on Ashmoon is radiation now, and it gets stronger the deeper you go.",
      "Masks wear out faster deeper down: the gas mask lasts 30 seconds near y 30 and only a few seconds below y -25. Mekanism's hazmat mask now wears out too: about 30 minutes, less deeper down.",
      "Below y -25 the radiation kills. Only a full hazmat suit (mask, gown, pants and boots) or a full MekaSuit keeps you alive there, and the hazmat suit wears out quickly that deep.",
    ],
  },
  {
    // docs/22a §6: the privacy and terms pages the Discord app links to.
    id: "2026-10-16-privacy-terms",
    date: "2026-10-16",
    lines: ["The site has a Privacy page and a Terms page, linked at the bottom of every page: what the site keeps about you and for how long, and how the server works. Anyone can open them, signed in or not."],
  },
  {
    // The animal and cosy mods, straight into the pack (Alex, 2026-10-20). Set `live: true` only after the live check
    // (the rule above).
    id: "2026-10-20-animals-and-cosy",
    date: "2026-10-20",
    title: "Animals and cosy things",
    lines: [
      "Lots of new animals: deer, bears, otters, red pandas, ducks and geese, birds that really fly, the copper golem, the moobloom and many more. A few bite, so take care in swamps and by the sea. Most turn up in land nobody has been to yet.",
      "Fairy lights to hang between fences, sleeping bags and hammocks, lanterns that hang on walls, carpet on stairs, and pebbles, twigs and new stone.",
      "New farming: tomatoes, corn, strawberries and more, cheese from the mountain meadows, and grapes to press into wine.",
      "Crows, moths and spiders now come and go around you on your own screen. Main menu, Mods, Cosy Critters, Config switches off any of them.",
      "The Mods page has an Animals section that says where to find them. Press Play to update.",
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

/**
 * One entry as a Discord message: the date in bold (with a big update's title after it), a bullet per line. Too long
 * for one message: cut at a line break.
 */
/** `max`: less than Discord's limit when something goes in front of it (the role's mention, docs/53 D1). */
export function changeText(c: Change, max = DISCORD_MAX): string {
  const [y, m, d] = c.date.split("-").map(Number);
  const lines = [`**${d} ${MONTHS[(m ?? 1) - 1]} ${y}${c.title ? `: ${c.title}` : ""}**`, ...c.lines.map((l) => `• ${l}`)];
  const whole = lines.join("\n");
  if (whole.length <= max) return whole;
  const kept: string[] = [];
  let size = CHANGE_CUT.length;
  for (const l of lines) {
    if (size + l.length + 1 > max) break;
    kept.push(l);
    size += l.length + 1;
  }
  return [...kept, CHANGE_CUT].join("\n");
}
