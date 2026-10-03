# 18 · Player guide (portal page `/guide`)

Planner spec and first content, 2026-09-29. A player-facing page in the portal, editable by admins in Markdown via `/admin/branding` (same mechanism as the rules page). Ships with the content below as the default; the mod-specific sections are shown or hidden automatically based on which mods are enabled in `mods.json` (tag each section with the mod slug it needs).

Keep every section short. The reader is a friend who has never played modded and will stop reading after two sentences.

---

## Getting in

1. Go to deepslate.dsw.test and sign in with Discord.
2. Download the installer, close the Minecraft Launcher, double-click Setup.bat.
3. From then on, press **Play** on the site. It updates the mods and opens the game.

The first time you join you'll be in a small room. Click the link in chat, sign in with Discord, and you're through. You never need to type a username or ask to be whitelisted.

## Where things are on the site

- **Home**: is the server on, who's playing, the live map.
- **Map**: full-screen live map with everyone's position. Press M in the game for the same map on your screen.
- **Players**: who's in the group and when they last played.
- **Stats**: play time, deaths, who plays most, busiest hours.
- **Events**: joins, deaths, server restarts.
- **Me**: your account, your last install, and quick actions once they're switched on.

## The basics that are different from vanilla

- **JEI**: press R on any item to see how it's made, U to see what it makes. Type in the search box bottom-right to find anything.
- **Jade**: look at a block or mob and it tells you what it is at the top of the screen.
- **Voice chat**: hold V to talk to people near you. Press V once to open the settings (mute, volume, push-to-talk key).
- **Minimap**: corner of the screen. M opens the big map. Press B to drop a waypoint where you stand.
- **Tab**: press Tab: who's on, everyone's ping, and the server's TPS (20 is perfect). <!-- mod: bettertabinfo -->
- **Corpse**: when you die, your stuff stays in a body where you fell. Only you can loot it for the first while. It shows on the map.
- **Backpacks**: you start with one in your inventory. A magnet upgrade comes later, so it picks things up for you.
- **Waystones**: find or build one, click it, and you can teleport between any you've discovered.
- **VeinMiner**: hold the grave key (` under Esc) while breaking ore or a log and the whole vein or tree comes out. Costs hunger, so bring food.
- **FallingTree**: break the bottom log and the whole tree falls, no axe needed. <!-- mod: fallingtree -->

## Your first hour

1. Punch a tree, make a crafting table, make a wooden then stone pickaxe as usual.
2. Open your backpack: you start with one, with tools, bread, torches and a bed.
3. Find a waystone or build one so you can always get home.
4. Pick a spot for your base away from spawn and other people; use a waypoint (B) to mark it.

## Power and machines <!-- mod: create -->

Create is the factory mod. Everything runs on rotation from **water wheels** and **windmills** to start with. Rough order:

1. Andesite alloy (andesite + iron nugget) → **shafts**, **cogwheels**, **mechanical press**.
2. Water wheel next to flowing water → shaft → whatever you want to turn.
3. Mechanical press + belt = automatic plates. Millstone = flour, dyes, gravel to sand.
4. Later: steam engines for serious power, trains if you get ambitious.

Press R on any Create block and JEI shows the recipe; most Create blocks also have a little animated guide (Ponder) if you hold W over them in JEI.

## Electricity <!-- mod: createaddition -->

Create: Crafts & Additions turns rotation into electricity. **Alternator** on a spinning shaft → **wires** → machines that want power (the quarry, for one). Batteries store it.

## The quarry <!-- mod: additional-enchanted-miner -->

Mark out an area with **markers** (place them at the corners, right-click to link), put down the **quarry** block, give it power, and it digs everything inside the area down to bedrock into a chest or pipe next to it.

Please: quarries only well away from spawn and from other people's bases. They leave big holes. Fill in or fence off anything near a path.

## Pipes <!-- mod: pipez -->

Pipez gives one pipe each for items, fluids and power. Place it against a chest or machine, then use the **wrench** on the end to set pull or push. That's all you need to connect a quarry to a chest or a generator to a machine.

## Guns <!-- mod: tacz-1.21.1 -->

Guns are crafted on the **gun workbench** (needs Create parts). Press R to reload, hold right-click to aim, Z to switch fire mode. Ammo is crafted at the same bench. There's no PvP on this server, so they're for mobs.

## Home, spawn and getting unstuck

On the **Me** page:
- **Take me to spawn**: teleports you to spawn.
- **Set my home** / **Take me home**: one saved spot.
- **Where am I**: your coordinates and dimension.
- **Unstick me**: if you're wedged somewhere, this kills you so you respawn. Your stuff stays in your corpse.

Each of these has a cooldown so nobody spams them.

## Rules

Short version, the full version is on the Rules page:
- Don't grief. Don't take from chests that aren't yours.
- Quarries and big machines away from spawn and other bases.
- If you leave the Discord server you lose access to the game.
- Be nice on voice chat.

## Something's broken?

- Game won't start after an update: press Play on the site again. If it still fails, the site will have your install log and Alex will look.
- "Mod mismatch" when joining: same thing, press Play on the site so your mods match the server.
- Server shows "asleep": just join, it wakes up in about 30 seconds.
- Anything else: ask in the Discord.

---

## Implementation notes for the VPS session

- Page at `/guide`, linked in the nav. Rendered from Markdown stored like the rules page; the default is the text above, seeded on first run.
- Sections carrying an HTML comment `<!-- mod: <slug> -->` are hidden when that slug is not `enabled` in `mods.json`, so the guide tracks the vote without editing.
- A short version of "Getting in" also appears on the login page for people who arrive without an account.
- Keybinds mentioned are the mods' defaults; if the config overrides change them, update the text.
- Acceptance: with the current manifest, the Create/Electricity/Quarry/Pipes/Guns sections show only for enabled mods; editing the guide in `/admin/branding` is live on the next load.
