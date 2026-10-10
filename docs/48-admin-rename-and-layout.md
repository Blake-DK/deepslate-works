# 48 · Admin: the rename, where things sit and Maintenance

Planner, 2026-10-10, against `dev` `9714a905`. Alex's ask: "the control room needs to be renamed admin and also the
location of things dont make sense", then his picks: the first page, the strip and cards on the wrong page are all
open, the planner decides. He chose three moves by name (Builds get their own page, players come off the first page,
News and Votes become one page) and added: a Maintenance button on the first page of the live site.

He did not pick "one Test page". The test server's card, the test door and the test clock stay where they are.

Two parts. Part A moves and renames, with no change to the api, the database or any action's behaviour. Part B is
Maintenance, which changes the database, the api and the door. Build A first, as its own commits, so it can be
deployed alone.

## Part A · The rename and the layout

### A1. The name

"Control Room" goes everywhere a person can read it. The area is **Admin**. Its first page is **Overview**.

| Where | Now | Becomes |
|---|---|---|
| Main strip, the copper tab | Control Room | Admin |
| Admin strip, first tab | Control Room | Overview |
| The first page's `h1` and browser title | Control Room | Admin |
| Texts that name the place ("Flip it in Admin → …", hints, `HowThisWorks`, bot lines, flash messages) | Control Room | Admin → Overview |

Code comments and test names that say Control Room change with it, so a search for the old name in `apps/` finds
nothing. `ROADMAP.md` line 76 changes too. Older docs keep their wording: they are history.

The address stays `/admin`.

### A2. The strip

Now: Control Room · Server · Joining · People · Modpack · Seasons · News · Votes · Discord · Site.

Becomes: **Overview · Server · Joining · People · Modpack · Builds · Seasons · News & polls · Discord · Site**.

Ten before, ten after. The Live | Test switch at the right end is unchanged.

### A3. Overview (the first page)

It answers one question: is anything wrong, and where do I go. It holds no second copy of a control that lives on
another page, with one exception: Maintenance (Part B), because Alex asked for it here.

Top to bottom:

1. **The heading row**: "Admin" and the status line, as now.
2. **What needs attention**, each shown only when there is something to say, as now: the flash message, the health
   watch, "a Build or Sync is needed" with its link, the build designer's problem line.
3. **Maintenance** (Part B). Until Part B is built this row is absent.
4. **At a glance**: a grid of tiles. A tile is a link to the page that holds the controls. No buttons on a tile.

   | Tile | Shows | Goes to |
   |---|---|---|
   | Server | state, uptime, a planned restart if one is set | Server → Power & restarts |
   | Playing now | the count, then each player's head and name. A name goes to that player's page | People → Members |
   | At the door | how many are held in the entrance room | Joining → Who's waiting |
   | Backups | when the newest backup was kept, or the job in progress | Server → Backups |
   | Members | members and open invites (today's one line) | People |
   | Test server | today's card, unchanged, on the live site only | as now |

5. **Last 5 console lines** with "Open console", as now.
6. **What admins did lately**, as now.

What leaves the page:

- **The players list on the left and the inventory view.** A player's inventory is already on their page
  (`/players/<uuid>`, the Inventory tab, admins only). `/admin?p=<uuid>` redirects there with that tab open.
- **The copies of Power, Restart with a warning, Back up now and "In the entrance room".** Each stays on its own
  page. The `back="/admin"` path of those cards and of their actions goes, as nothing sends it any more.

The page keeps its 30 second refresh.

### A4. Cards that move

| Card | From | To |
|---|---|---|
| Design a build | Seasons | **Builds** (new page, `/admin/builds`) |
| Builds (uploads, place, lock, capture) and Builder mode | Seasons | **Builds** |
| Post news, Announcements | News | **News & polls → News** (`/admin/news`) |
| New poll, the polls | Votes | **News & polls → Polls** (`/admin/news?tab=polls`) |
| Kick a player back to the door | Joining → Who's waiting | **People → Members**, under the table. It takes a typed name because it also works on somebody who is not a member. A linked member's row menu gains the same action as "Kick back to the door" |

Everything else stays where docs/35 put it.

**Builds** has no tabs: Design a build, then Builds. Its intro: "Design a build, upload one and place it in the
world." The flash messages those cards use move with them. Seasons' intro stays as it is and Seasons keeps the
season's switches, the datapack card, the ticks and, on the test site, the test tools.

**People → Members** shows who is playing: a member who is on the server now has an "online" mark and their ping,
and those rows sort first. A row's menu gains "Inventory", which opens their page on the Inventory tab. It is absent
for a member with no linked Minecraft account.

### A5. Old addresses keep working

| Old | Goes to |
|---|---|
| `/admin/votes` | `/admin/news?tab=polls` |
| `/admin/seasons?design=<name>` | `/admin/builds?design=<name>` |
| `/admin/seasons#design` and any link to the Builds card | `/admin/builds` |
| `/admin?p=<uuid>` | `/players/<uuid>?tab=inventory` |

Every link and every text that names a moved card changes with it: Joining → Rules says "Close it on Votes" and
becomes "News & polls → Polls", the Modpack messages that say where an uploaded build goes, the bot's lines and
anything else a search finds. The redirects of docs/35 stay.

### A6. Proof for Part A

Unit tests are not the proof. On the test site, from the `dev` image, at 1280 px and at 390 px:

- [ ] The main strip says Admin. The admin strip reads Overview · Server · Joining · People · Modpack · Builds ·
      Seasons · News & polls · Discord · Site and scrolls sideways on the phone without wrapping.
- [ ] Overview has the rows of A3 in that order and no button but Maintenance's (none before Part B).
- [ ] Each tile opens the page named in A3.
- [ ] Builds: a design opens from `/admin/seasons?design=<name>`, a build places and locks, Builder mode switches on
      and off. Each action comes back to Builds with its message.
- [ ] News & polls: a news post and a poll are each made and closed from their tab and come back to that tab.
- [ ] People → Members: an online member sorts first with the mark. "Inventory" opens the right page. "Kick back to
      the door" from a row and the typed-name card both come back to People.
- [ ] The four old addresses of A5 land where the table says.
- [ ] `grep -ri "control room" apps/` prints nothing.

Pictures of Overview, Builds and News & polls at both widths go with the report.

## Part B · Maintenance

docs/46 §3 (2026-10-09): "server online, only admins with a tick on their profile can join". docs/47 §5 item 6: without
it, switching "We're live" off shows players launch wording.

This is the site's own Maintenance. AMP has a state of the same name (250). The two have nothing to do with each
other and the code must not use one word for both without saying which.

### B1. What it is

- **One switch**, kept in the site's settings: Maintenance on or off. It is separate from "We're live" and from
  Play first, and it changes neither.
- **One tick per admin**: "Can join during maintenance". Only an admin can have it. It is set in the member's menu on
  People → Members and on their player page, like Builder tools, and it is cleared when an admin is made a player.
- **While it is on**, the door lets in an admin who has the tick and nobody else. An admin without the tick waits like
  a player.

The server keeps running. Nothing is stopped, restarted or synced by the switch.

### B2. The door

Order at the door for somebody who joins: the link and the Discord server rule first, as today. Then Maintenance.
Then "We're live", the must-vote polls and Play first, as today.

- **Held for maintenance**: into the entrance room like every other hold, with its own line on screen and in chat,
  its own reminder and its own idle kick. The words, the same in all three:
  **"Down for maintenance. You'll be let in when it's done."**
- **Switched off**: whoever is held for maintenance is looked at again within seconds and goes on through the rest of
  the door, back to where they stood, the way "not open yet" clears when "We're live" goes on.
- **Switched on**: everybody on the server who does not have the tick is kicked at once with the same words. They are
  not moved into the room. Their place in the world is kept by the game as with any kick.
- **Release** on the held list still lets one member in by hand whatever the door says, as today.
- A hold for maintenance is its own reason in Joining → "Held at the door lately" and in Activity:
  "<name> was held: the server is down for maintenance".

Planner's call, Alex can change it: the kick is at once and without a countdown. He can post news or use "Restart
with a warning" style wording first if he wants people warned.

### B3. The card on Overview

On both sites, each with its own switch, so it is rehearsed on test before it is used on live.

- Title "Maintenance" with a badge: off or **on**.
- Off: one line of what it does, who has the tick by name, how many are playing now and how many of them would be
  kicked. A tick "I'm sure" and the button **Start maintenance**.
- If the admin pressing it has no tick, the card says so above the button: "You do not have the tick: you will be
  kicked too." It does not refuse.
- If no admin has the tick, the button is disabled and the card says where to give it.
- On: since when and who switched it on, who is held for it now, and the button **End maintenance**. No "I'm sure".
- Both presses are recorded as admin actions in Activity.

Joining → Rules gains one line, not a second switch: "Maintenance is on/off. It is switched on Admin → Overview."

While it is on, every admin page shows it, so it cannot be left on unnoticed: the status pill in the banner reads
"Maintenance" for admins in place of the usual line.

### B4. What members see

- **The site**: a banner on Home and on Getting started in place of the address block:
  "Down for maintenance. The server is being worked on. You'll be let in when it's done." Never the "Not live yet"
  wording while "We're live" is on.
- **The status pill and the app's line**: the short status line members get reads "Down for maintenance". The app
  takes that line from the site, so 3.6.1 shows it with no new build. This spec changes nothing in the app.
- **Downloads and Play are unchanged.** A member can still press Play. If they then join they are held with the
  words of B2. Report what the 3.6.1 app shows a member in that case. If it is wrong or misleading, say so and stop
  on that point. Do not build an app change under this spec.
- **Discord**: nothing is posted when it goes on or off.

### B5. Proof for Part B

Tests first: the door's table gains the maintenance rows (player, early access, admin without the tick, admin with
it, each with "We're live" on and off) and the two shared copies stay identical.

Then in its real state, on the test server, with Alex and one more account. Three checks, Alex does them:

- [ ] Maintenance on. An account without the tick joins: held, the words of B2 on screen and in chat. Alex, with
      the tick, joins and plays.
- [ ] Maintenance off: the held account is let in within 10 seconds, where it last stood.
- [ ] Both in the world, Maintenance on: the account without the tick is kicked with the words, Alex stays.

The VPS session reports the log lines of each hold, release and kick, the two admin actions as Activity shows them
and what a member's Home, pill and app read while it was on.

## Order and deploy

1. Part A on `dev`, proof of A6 on the test site, report.
2. Part B on `dev`, with its migration, proof of B5 on the test server, report.
3. `dev` to `main` by PR when Alex says. Part B's migration runs on live's database at that deploy. The switch is off
   after it.

Not in this spec: the tester tick for non-admins (docs/46 §7 item 5), a countdown before the kick, a Discord post,
any change to the app, one Test page.
