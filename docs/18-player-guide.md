# 18 · Player guide (the Guide tab of Getting started)

Planner. First written 2026-09-29, **rewritten 2026-10-04** on Alex's "the guide on the site needs updating and simplifying". This replaces the earlier text of this file whole. Input for the VPS session: read it, don't rewrite it. Report in `docs/11-status.md`. Small job, straight to main, no PR.

## 1. Why

The guide was written before go-live and has fallen behind:

- It says "double-click Setup.bat". Since app 3.0 the download is `DeepslateWorks.exe`.
- "Where things are on the site" lists pages that have been merged or renamed (Players, Stats, Events).
- It has nothing on bosses, and nothing on what to do when the game will not start beyond "press Play again", though the app has **Send to Alex** since 3.4.2.
- It repeats what three other places already say better: the **Getting in** tab (install steps), the **Mods guide** (how each mod works, generated from `mods.json`) and the **Rules** tab.

So the new guide is one short page: what a friend needs in their first evening, then links. Thirteen sections become seven. Anything about one mod lives in the Mods guide and nowhere else.

**What is gone, on purpose:** "Where things are on the site" (the nav says it), the sections for Power and machines, Electricity, The quarry, Pipes, Guns and Building (one line each under "What to do next" instead), "Making it look nicer" (one line), the Rules summary (one link), and "Home, spawn and getting unstuck" (one tagged line under "If something's wrong", still hidden until the buttons exist).

## 2. The guide

The text between the two rules below is the guide as it ships. `apps/web/src/lib/guide-default.ts` is generated from it, word for word, tags included.

---

## Getting in

1. Go to deepslate.dsw.test and sign in with Discord.
2. Download DeepslateWorks.exe and run it once.
3. After that, just press **Play** on the site or open Deepslate Works from your desktop. It keeps itself up to date.

The first time you join you'll be in a small room. Click the link in chat or right-click the book in your hand, sign in with Discord and you're through. The full steps, with a picture of the Windows warning, are on the [Getting in](/help?tab=in) tab.

## Your first ten minutes

1. You start at spawn with a kit in your inventory: stone tools, bread, torches and a bed.
2. The kit has a backpack in it too. Right-click it to open it. <!-- mod: sophisticated-backpacks -->
3. Walk out of spawn before you dig or build. Spawn is protected: you can't break or build there.
4. Pick a spot away from other people's bases and press **B** to mark it on your map. <!-- mod: xaeros-minimap -->
5. Put your bed down and sleep in it, so that's where you come back when you die.

## Keys worth knowing

- **R** on any item shows how it's made, **U** what it's used in. <!-- mod: jei -->
- **M** opens the big map. **B** marks where you stand. <!-- mod: xaeros-minimap, xaeros-world-map -->
- **V** is voice chat. The first press sets up your microphone; after that people near you hear you. <!-- mod: simple-voice-chat -->
- **'** (apostrophe, next to Enter) opens parties and claims. <!-- mod: open-parties-and-claims -->
- **Tab** shows who's on and how well the server is running. <!-- mod: bettertabinfo -->

Every mod has a card with its keys in the [Mods guide](/mods).

## Things that just work

- Break the bottom log and the whole tree comes down. Sneak to take one log. <!-- mod: fallingtree -->
- Mine one ore and the whole vein comes out. It costs hunger, so bring food. <!-- mod: veinminer -->
- Look at any block or mob and a small box says what it is. <!-- mod: jade -->
- Right-click a waystone to switch it on. You can teleport between the ones you've found. <!-- mod: waystones -->
- When you die, your things stay in your body where you fell. It never disappears and your map marks the spot. For 30 minutes only you can open it; after that your friends can too. <!-- mod: corpse -->

## Playing together <!-- mod: open-parties-and-claims -->

1. Press **'**, create a party and invite your friends by their Minecraft name.
2. They press **'** too and accept. From then on you see each other on the map, however far apart you are.
3. To protect your base, open the map (**M**), right-click a chunk and choose **Claim**. Only you and your party can break, build and open chests there.

You get up to 200 chunks, and they stay yours as long as you've played in the last 90 days.

Quarries don't dig in claimed chunks, yours included: leave the quarry's area unclaimed. <!-- mod: additional-enchanted-miner -->

## What to do next

- **Build a factory.** Start with a water wheel and a shaft. [Create](/mods#create) <!-- mod: create -->
- **Fight a boss.** Big dungeons are out in the world, each guarded by a boss. Go as a group. [Bosses](/mods#l-enders-cataclysm) <!-- mod: l_enders-cataclysm -->
- **Dig a quarry.** Well away from spawn and from other people's bases: they leave big holes. [The quarry](/mods#additional-enchanted-miner) <!-- mod: additional-enchanted-miner -->
- **Make guns.** They're for mobs: there's no PvP on this server. [Guns](/mods#tacz-1.21.1) <!-- mod: tacz-1.21.1 -->
- **Build something nice.** Roofs, windows, doors and furniture are all in the [Mods guide](/mods).
- **Make it look nicer.** Shaders and other visual extras, only on your PC: the **Extras** tab in the Deepslate Works app. [Your extras](/mods#iris)

The [Rules](/help?tab=rules) are short. Read them once.

## If something's wrong

- **The game won't start, or says the mods don't match:** close it and press Play again. Still stuck? Open the **Log** tab in the Deepslate Works app and press **Send to Alex**.
- **The server shows "asleep":** just join, it wakes up in about 30 seconds.
- **Chat says it isn't allowed:** your Microsoft account has chat switched off. You can still get in with the book. To turn chat on: account.xbox.com → Privacy & online safety → Xbox privacy → allow communicating outside of Xbox with voice and text, then restart Minecraft.
- **The game stutters:** turn Render Distance down in Options → Video Settings. 8 is plenty.
- **You're stuck somewhere:** on the **Me** page, **Unstick me** kills you so you respawn. Your things stay in your body. <!-- feature: actions -->
- **Anything else:** ask in the Discord.

---

## 3. What to build

1. **`apps/web/src/lib/guide-default.ts`:** generate it again from §2, word for word. Nothing in `guide.ts` changes: the tags, `filterGuide`, `section` and `gettingIn` stay as they are.
2. **Check every fact against the live source before it ships** (the working rules's rule). If one is wrong, change that line in `guide-default.ts`, leave this file alone and say which in the report:
   - `pvp` in the running server's `server.properties` is `false`. If it is `true`, the Guns line loses "there's no PvP on this server" and becomes "**Make guns.** [Guns](/mods#tacz-1.21.1)".
   - `/mods#l-enders-cataclysm` is the anchor the Mods guide gives Cataclysm (`anchorOf` turns the underscore into a hyphen). The other anchors (`create`, `additional-enchanted-miner`, `tacz-1.21.1`, `iris`) exist on the page.
   - `/help?tab=in` and `/help?tab=rules` open those tabs.
   - The app's Log tab has a **Send to Alex** button with that label (3.4.2).
   - OPAC's limits are still 200 chunks and 90 days in the shipped server config.
3. **Somebody's own text in the way.** The shipped guide only shows while `branding.guide` is empty. Read it on the live site (Admin → Branding → "Guide page"). If it is empty, nothing to do. If it holds a text, **do not overwrite or clear it**: put the saved text in the report and stop there. Alex decides whether to drop it.
4. **The backpack card in the Mods guide** still says "Craft a **backpack** (leather and a chest) as soon as you can". In `modpack/mods.json`, `sophisticated-backpacks` → `howTo`, the first sentence becomes "You start with a **backpack** in your kit." The rest of the text stays. A `howTo` is not in the lock, so no Lock and no new pack version: say in the report if that turns out to be wrong.
5. **Tests**, `apps/web/tests/guide.test.ts`, "the guide as it ships". The tests of `filterGuide`, `section` and `gettingIn` above it do not change. Rewrite the block to say what the new guide promises:
   - names only mods that are in the mod list (kept; the count of tags is still above 8).
   - "Getting in" is always shown; "Playing together" shows only while `open-parties-and-claims` is on; "Spawn is protected: you can't break or build there." shows whatever the mod list is.
   - each tagged line shows only while its mod is on, one mod at a time, and nothing else moves: `sophisticated-backpacks` ("The kit has a backpack in it too."), `jei`, `simple-voice-chat`, `bettertabinfo`, `fallingtree`, `veinminer`, `jade`, `waystones`, `corpse`, `create`, `l_enders-cataclysm`, `additional-enchanted-miner` (both its lines), `tacz-1.21.1`. The **M** and **B** line needs both Xaero mods.
   - with the backpack and the minimap off, "Your first ten minutes" still reads as a list numbered without a gap.
   - no `<!--` in what is shown, and no "Unstick me" while `FEATURES.actions` is false.
   - the sign-in page still gets three steps, the first starting "1. Go to deepslate.dsw.test", the third holding "press **Play** on the site".
   - it reads as Markdown with **seven** headings when every mod is on, and no line of it says "Setup.bat".
   - every `/mods#…` link in the guide is the anchor of a switched-on mod or of an extra (build the set with `guideParts`, so a renamed slug fails CI and not a friend's click).
6. **Deploy** as usual: push to main, CI, `deploy/deploy.sh`.

## 4. Acceptance

- [ ] The Guide tab on the live site shows the seven sections of §2, no "Setup.bat", no comment marks.
- [ ] Every link in it opens the place it names.
- [ ] The sign-in page shows the three steps with `DeepslateWorks.exe` in the second.
- [ ] The backpack card in the Mods guide says they start with one.
- [ ] `deploy/check.sh` passes; CI is green.
- [ ] docs/11's "Player guide" section says what was checked in step 2, what `branding.guide` held, and what differs from §2 if anything.

## 5. Not part of this job

Seen while reading, left alone, for Alex to say yes or no to:

- `apps/web/src/app/(app)/me/page.tsx` line 65 still tells people to "Run Setup.bat again from the extracted download". It wants the same wording as the Getting in tab uses for the exe.
- **B** is the default key for both "new waypoint" (Xaero's Minimap) and "open the backpack you wear" (Sophisticated Backpacks). The guide only uses B for the waypoint and says right-click for the backpack, so it is right either way. Whoever is next in game with a backpack worn: say which of the two B does.
- Seasons are not in the guide. They get a section when docs/20's season is built, not before.
