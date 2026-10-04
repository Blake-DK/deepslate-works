# 30 · The launcher's Settings tab

Planner, 2026-10-04. Input for the VPS session: read it, build it in the order of §10, record deviations in `docs/11-status.md`. App version **3.5.0**. One PR (this is a big update, not a little instruction).

## 1. What Alex asked for

"In the launcher there should be a settings tab where people can change the amount of RAM for the game and all the render distances and anything else they might like, and being able to turn on the prisoner villager mod from there so all villagers have that skin."

So: a fifth tab, **Settings**, between Extras and Log. Four cards on it:

1. **Memory**: how much RAM the game gets.
2. **Graphics and sound**: render distance, entity distance and the handful of game options people actually change.
3. **Villagers**: a switch for the prisoner skin (the Deepslate texture pack, `modpack/resourcepack/`, docs/06).
4. **The Play button on the website**: the three choices that live in the small "Play settings" window today.

Everything on the tab is personal and client-side, like Extras: the server, the vote and the join check never see it, and nothing here changes the pack's version.

## 2. Three rules that decide the rest

1. **The game's own file is the truth.** Graphics, sound and the resource pack list live in `<game folder>\options.txt`. The tab reads that file every time it is opened and writes it on Save. It keeps no copy of its own, so a change made in the game's Options screen shows on the tab the next time it is opened, and the tab never puts back a value the player changed in game. The only thing the app remembers itself is the memory choice and the website Play choice (`settings.json`), because those are not in `options.txt`.
2. **Only the named lines change.** Same manner as `SetRenderDistance` and `SetResourcePackList`: every other line, the order and the line endings stay; a missing line is added at the end; written to `options.txt.new`, then moved over. One helper, `GameOptions` (§6), and nothing else writes these keys.
3. **Nothing is forced.** Every control has a recommended value and one button puts them all back. A weak PC gets a warning next to a costly choice (the Extras tab's rule and wording), never a block.

## 3. The tab

`SettingsTab`, header "Settings", after `ExtrasTab`, before `LogTab`. Styled by the existing `TabItem` template; cards are `Card` with the 1 px `Line` border; headings Segoe UI SemiBold 15 (no pixel face: docs/21 §11 keeps it to three places and `LookTests` counts them).

Layout at 980×620, a two-column `Grid` like the Play tab (columns `340` and `*`, gap 16), inside a `ScrollViewer`:

- **Left column:** Memory, Villagers, The Play button on the website.
- **Right column:** Graphics and sound.
- **Bottom row, both columns:** `SettingsStatus` on the left (`Muted`; `GreenText` after a save, `Red` on a problem), then `SettingsRecommended` (`Plain`, "Back to recommended") and `SettingsSave` (`Primary`, "Save") on the right.

Nothing is written until Save, except the website Play choice, which saves at once as it does today. Save is disabled until something differs from what is on disk. Leaving the tab with unsaved changes keeps them on screen until the window closes; no question box.

**The cog on the Play tab** (`SettingsLink`) stays where it is, reads "⚙ Settings" and selects this tab. The small window goes: `SettingsXaml`, `SettingsNames`, `MakeSettings` and `ShowSettings` are removed, and their tests move to the tab. Pressing it still stops a countdown ("a setting"), and so does selecting the tab any other way.

The tab is disabled in the guided setup (as Extras is until step 4) and while the install steps are running (a tooltip says "Wait for the update to finish").

## 4. The cards

### 4.1 Memory

| Element | Name | What |
|---|---|---|
| Check box | `RamAuto` | "Let Deepslate Works choose (recommended)". On by default. |
| Slider | `RamSlider` | Whole GB, enabled when `RamAuto` is off. |
| Value | `RamValue` | "6 GB", SemiBold, right of the slider. |
| Line | `RamNote` | `Muted`: "Your PC has 16 GB. Deepslate Works would pick 6 GB." |
| Warning | `RamWarn` | `Copper`, hidden unless a rule below fires. |

- **Automatic** is today's rule in `Engine` unchanged: 3 / 4 / 5 / 6 GB for under 8 / 8 / 12 / 16 GB and up, clamped to the mod list's `ram.min_gb` and `ram.max_gb`.
- **Range of the slider:** from `ram.min_gb` to `min(ram.user_max_gb, PC's memory − 4)`. `ram.user_max_gb` is new in `mods.json` (**12**; optional in the schema, and the app reads a missing one as 8). When the top of the range is not above the bottom (a PC under 8 GB), the slider and the check box are disabled and `RamNote` reads "Your PC has 6 GB, so the game gets 3 GB. That's the most it can safely have."
- **Warnings**, one at a time, the first that applies: more than half the PC's memory: "That's more than half your PC's memory. Windows, Discord and your browser need some too."; above 8 GB: "More isn't faster: past 8 GB the game can stutter when it tidies up its memory."
- **Stored** in `settings.json` as `ramGb` (a whole number, or absent for automatic). §5.
- **Takes effect** the next time the game starts, because `-Xmx` is in the launcher profile and the engine writes the profile on every Play (the launcher has to be closed for that, which the engine already checks). After Save: "Saved. The game gets 8 GB from the next time you press Play."
- **Engine** (`Adding the launcher profile`): when `ramGb` is set, `xmx = clamp(ramGb, min_gb, min(user_max_gb, totalGb − 4))`, never below `min_gb`; the automatic value otherwise. The tick line says which: "Profile 'Deepslate Works' with 8 GB of RAM (chosen in Settings; your PC has 16 GB), saved and checked". A chosen value that had to be clamped (the memory was taken out of the PC, or the mod list's limit came down) adds a note and is not rewritten in `settings.json`.
- The rest of `javaArgs` stays as it is. No box for typing Java arguments: nobody in this group needs one, and a wrong one stops the game starting.

### 4.2 Graphics and sound

Reads and writes `options.txt`. **Before the first install** (no `options.txt`) the card shows one line instead of its controls: "These appear after your first Play." Memory and the other cards work regardless.

| Label | Control | Key in `options.txt` | Values | Recommended |
|---|---|---|---|---|
| Render distance | slider, chunks | `renderDistance` | 4 to 16 | the mod list's `render_distance` for this PC's tier |
| Entity distance | slider, % | `entityDistanceScaling` | 50 % to 500 % in steps of 25 (file: 0.5 to 5.0) | 100 % |
| Frame rate limit | slider | `maxFps` | 30 to 250 in tens, then "Unlimited" (file: 260) | 120 |
| VSync | switch | `enableVsync` | true / false | on |
| Full screen | switch | `fullscreen` | true / false | off |
| Graphics | Fast / Fancy | `graphicsMode` | 0 / 1 | LOW tier: Fast; otherwise Fancy |
| Clouds | Off / Fast / Fancy | `renderClouds` | `"false"` / `"fast"` / `"true"` (quoted in the file) | LOW: Off; otherwise Fast |
| Particles | All / Fewer / Fewest | `particles` | 0 / 1 / 2 | LOW: Fewer; otherwise All |
| Smooth lighting | switch | `ao` | true / false | on |
| Entity shadows | switch | `entityShadows` | true / false | LOW: off; otherwise on |
| Field of view | slider, degrees | `fov` | 30 to 110 (file: `(degrees − 70) / 40`, so 70 is `0.0`) | 70 |
| Brightness | slider, % | `gamma` | 0 to 100 (file: 0.0 to 1.0) | 50 |
| Menu and text size | Auto / 1 / 2 / 3 / 4 | `guiScale` | 0 to 4 | Auto |
| Volume: everything | slider, % | `soundCategory_master` | 0 to 100 (file: 0.0 to 1.0) | 100 |
| Volume: music | slider, % | `soundCategory_music` | 0 to 100 | 100 |

- **Verify before hardcoding** (the working rules's rule): take an `options.txt` written by Minecraft 1.21.1 with this pack's Sodium installed (Alex's PC, or the windows runner after one start of the game) and check every key name, its value format and its range against the table. Keep that file as the test fixture (`installer/tests/DeepslateWorks.Tests/fixtures/options-1.21.1.txt`). A key that turns out different is corrected in the code and noted in docs/11; a key Sodium ignores is dropped from the tab, not shown dead.
- **A value the tab cannot show** (Fabulous graphics `2`, a render distance of 24 typed in by hand, a `guiScale` of 6) is shown as the nearest choice with "(set in game: 24)" beside it and is **left alone** on Save unless the player moves that control.
- **Simulation distance is not on the tab.** On a server the server decides it (Admin → Server → Settings), and the client's own line only counts in single-player. The engine keeps writing it with the tier's value as it does today. Showing a slider that does nothing would be a step to explain, so it is left out.
- **Render distance and the tier rule (docs/07, 1.5.4).** Unchanged, and it needs no new case: a value saved here that is not the tier's value is "set by you" and is left alone from then on; "Back to recommended" writes the tier's value, which the engine counts as its own again at the next Play, so that PC follows its tier once more.
- **The server's view distance.** The mod list gains `server_view_distance` (the expected `view-distance` in `mods.json` `server_properties`, 12 today). When the slider is above it: "The server shows 12 chunks. Higher than that costs frames and you see nothing more." Missing from the mod list: no line.
- **Weak PC** (the Extras tab's own test: under 8 GB or no graphics card of its own): a `Copper` line under render distance above 10 and under Fancy graphics: "This PC may struggle with this."
- **Minecraft is open.** The game holds its options in memory and writes the whole file when it closes, so a write now would be lost. Save then stores the changed keys as `pending` in `settings.json` (§5) and says: "Minecraft is open, so these apply the next time you press Play. To change them right now, use Options in the game." The engine's Settings step applies `pending` first (one `GameOptions.Set`, one tick line: "Your settings from the Settings tab applied (render distance 14, clouds off)"), clears it, then runs `SetRenderDistance` and `SetChatLinks` as today. Opening the tab with something pending shows the pending values and the same line. No restart question here: unlike an extra, nothing needs the game closed to be chosen.

### 4.3 Villagers

| Element | Name | What |
|---|---|---|
| Switch | `VillagerSwitch` | "Prisoner villagers" |
| Line | | `Muted`: "Every villager wears the prison outfit. Only you see it, and you can switch it off again here." |
| Picture | `VillagerPreview` | optional: the villager's face cut from the pack's `villager.png` (the front of the head: 8×10 px at 8,8 in the vanilla layout; check it against the file), `NearestNeighbor`, drawn 40×50. Skip it if it does not read at that size. |

- **Off by default.** Nobody gets it without switching it on. This is the installer change docs/06 "Not switched on yet" was waiting for, made as a personal switch instead of a default.
- **What it does:** `Extras.SetResourcePackList(options, want, ours)` with `ours = { "deepslate-textures.zip" }` and `want` the same when on, empty when off. The player's own packs and their order stay. The switch's state is read from `options.txt` (`file/deepslate-textures.zip` in `resourcePacks`), so switching the pack off in the game's Resource Packs screen shows here too.
- **The file itself** is already in `resourcepacks\` on every PC: `config.zip` brings it at every Play (docs/06). If it is not there (never played since PR #90), the switch is disabled with "Press Play once to download it."
- **On top of the extras' packs.** Fresh Animations re-models villagers and Extras → Apply adds its pack at the end of the list (the end is the top). When the switch is on, `deepslate-textures.zip` must be the last entry: both this card's Save and Extras → Apply finish by moving it there (`GameOptions.KeepOnTop(path, "file/deepslate-textures.zip")`, a no-op when it is absent). Extras' own `ours` list does not include it, so Apply never takes it out.
- **Check by eye with Fresh Animations on** (§11): the body, the head and the blink. Fresh Animations blinks through ETF with its own eyelid textures; if a blink flashes the vanilla face, add the matching blink texture to `modpack/resourcepack/` (the path ETF reads next to `villager.png`; look in the Fresh Animations zip for the name) and say so in docs/11.
- **Minecraft is open:** same as §4.2. The choice goes into `pending.villagers` and the engine applies it at the next Play. (The game can also reload packs with F3+T, but only its own Resource Packs screen changes the list while it runs.)
- **Which skin.** The switch turns on whatever `modpack/resourcepack/assets/minecraft/textures/entity/villager/villager.png` is on `main`. Swapping the picture is the README's three steps (replace the PNG, Lock, Build) and needs no app change. The card's words say "prison outfit": if the skin is ever changed to something else, change `UiText.VillagerTitle` and `VillagerNote` in the same PR as the PNG.

### 4.4 The Play button on the website

The question and the three radio buttons from the old window, unchanged in words and behaviour (`UiText.SettingsQuestion`, `WebsitePlayLabels`, `SettingsNote`; `AppSettings.WebsitePlay`). Saved the moment one is picked, as today.

## 5. `settings.json` version 2

```json
{
  "version": 2,
  "websitePlay": "countdown",
  "ramGb": 8,
  "pending": { "options": { "renderDistance": "14", "renderClouds": "\"false\"" }, "villagers": true }
}
```

- `ramGb` absent or null: automatic. `pending` absent: nothing waiting. `pending.villagers` absent: no change waiting.
- A version 1 file (only `websitePlay`) reads as it is; the first write makes it version 2 and keeps `websitePlay`. Every writer reads the file, changes its own key and writes it back (as `SetWebsitePlay` does), so one setting never wipes another.
- `pending.options` holds the file's own text for each key, so the engine writes it without knowing what the key means. Only keys in `GameOptions.Known` are accepted when it is read back; anything else in there is dropped and logged.
- A file that cannot be read counts as empty (automatic memory, countdown, nothing pending), with a log line. The app never refuses to play over its own settings file.
- Uninstall already removes the app's folder; nothing to add.

## 6. Code

- `installer/app/src/Core/AppSettings.cs`: `RamGb` / `SetRamGb(int?)`, `Pending` / `SetPending` / `ClearPending`, version 2.
- `installer/app/src/Engine/GameOptions.cs` (new): `Known` (the table of §4.2: key, kind, range, file format), `Read(path)` → the known keys' values, `Set(path, IDictionary<string,string>)` under rule 2, `KeepOnTop`, and the two conversions (`fov`, the percentages). Pure, no WPF, so its tests run on any runner. `SetRenderDistance` and `SetChatLinks` stay as they are.
- `Engine.cs`: apply `pending` at the start of the Settings step (§4.2); the memory rule (§4.1), with the bounds worked out by one function the tab also uses (`Memory.Range(totalGb, minGb, maxGb, userMaxGb)` and `Memory.Automatic(...)`), so the slider and the engine cannot disagree.
- `Ui`: `SettingsTab` and its names in `AppWindow.Names`; `AppUiSettings.cs` (partial `AppUi`) for the tab; words in `UiText`. The PC's memory comes from the same WMI read the engine uses; if it fails, 8 GB is assumed, as there.
- `Extras` Apply: one call to `GameOptions.KeepOnTop` after its `SetResourcePackList`.
- `modpack/mods.json`: `ram.user_max_gb: 12`. `packages/modpack/src/schema.ts`: optional number, at least `max_gb`. The mod list route passes `ram` through already; it gains `server_view_distance`.
- **Install report:** `settings: { ramGb: <chosen or null>, xmxGb: <what the profile got>, renderDistance, villagers: true|false }`, optional in the zod schema (`apps/web/src/lib/install-report.ts`), shown on Admin → Installs in the PC's line as "6 GB for the game (chosen)" / "(automatic)". Not in the minimal ping. It is there so "the game is slow" can be answered without asking what they set.
- **Log:** one line per save, old and new: `settings: memory 8 GB (was automatic)`, `settings: renderDistance 10 → 14, renderClouds "fast" → "false"`, `settings: prisoner villagers on`, `settings: kept for the next Play (Minecraft is open)`.
- `DeepslateWorks.ps1` (the 2.x bridge) is not touched.

## 7. Words

Plain English, British spelling, for the friend who has never opened a settings screen. Tooltips on the three that need one:

- Render distance: "How far you can see, in chunks (16 blocks each). The biggest thing you can change for a smoother game."
- Entity distance: "How far away animals, monsters and other players are drawn."
- Memory: "How much of your PC's memory Minecraft may use. Leave it to Deepslate Works unless the game runs out."

"Back to recommended" asks nothing; it fills every control with its recommended value (memory back to automatic, villagers left as they are, the website Play choice left as it is) and waits for Save.

## 8. Tests (xUnit, CI on the windows runner)

- `GameOptions.Set`: only the named lines change, byte for byte otherwise; CRLF and LF files; a missing key added at the end; the quoted clouds value; a file with no trailing newline; the fixture file round-trips with no change when nothing is set.
- Conversions: `fov` 30 / 70 / 110 both ways; 100 % ↔ `1.0`; "Unlimited" ↔ 260.
- An out-of-range value in the file is shown clamped and not written back unless changed.
- `Memory.Range` and the engine's clamp for PCs of 4, 6, 8, 12, 16 and 32 GB, with and without `user_max_gb`; a chosen value above the range is clamped and `settings.json` is not rewritten.
- `settings.json`: version 1 read; each setter keeps the other keys; a broken file reads as empty; unknown `pending.options` keys dropped.
- `pending`: with the game "running" (`Engine.GameRunningNow` stubbed) Save writes nothing to `options.txt`; the engine's Settings step applies it once and clears it; a second run changes nothing.
- Villagers: on, off, and on again leave the player's own packs and order alone; with Fresh Animations' pack switched on by Extras afterwards, `deepslate-textures.zip` is still last; the pack file missing disables the switch.
- Render distance: a value saved from the tab is left alone by `SetRenderDistance`; "Back to recommended" is taken over by the tier rule at the next run.
- The window: every new name is in `AppWindow.Names` and found; the tab fits at 900×560 with no clipped control (the width test of 3.3.1, extended); `ThemeTests`' contrast table covers the new text and background pairs; `LookTests` still finds the pixel face in exactly three places.
- web: the report schema accepts `settings` and still accepts a report without it; the mod list carries `server_view_distance`; the schema accepts `ram.user_max_gb` and a `mods.json` without it.
- Screenshots (`-Screenshots`): `30-settings` at 980×620, `31-settings-min-900x560`, `32-settings-game-open` (the pending line).

## 9. Not in this

- Java arguments, a choice of Java, or the game folder.
- Key bindings, language, skin, chat settings (the game's own screens do those).
- Sodium's own options (`config\sodium-options.json`).
- The server's distances (Admin → Server → Settings).
- Making the villager skin the default for everyone. If Alex wants that later it is one line: the engine switches it on once at a first install.

## 10. Order of work

1. The fixture `options.txt` and the key check (§4.2). Correct the table in this doc's status note if a key differs.
2. `GameOptions`, `Memory`, `AppSettings` version 2, with their tests.
3. The engine: `pending`, the memory rule, the report's `settings`.
4. `mods.json` `ram.user_max_gb`, the schema, `server_view_distance` in the mod list, the report schema and the Installs line.
5. The tab, the cog, the old window removed, `KeepOnTop` in Extras Apply.
6. Screenshots and `windows-smoke-3.ps1` (open the tab, save a memory choice, read `settings.json` and the profile's `javaArgs` back after an engine run).
7. `installer/VERSION` 3.5.0, docs/07 gains a short "3.5.0: the Settings tab (docs/30)" section, docs/06's "Not switched on yet" paragraph is replaced by a pointer here, docs/11 updated. Merge on green, deploy, Lock (for `mods.json`), Build (installer).

## 11. Acceptance

- [ ] The Settings tab opens on Alex's PC at 980×620 and at 900×560 with nothing clipped, and matches the other tabs by eye (Alex).
- [ ] Memory set to 8 GB: after the next Play the launcher profile's `javaArgs` has `-Xmx8G`, the log says "chosen in Settings", and F3 in game shows about 8 GB allocated. Back to automatic gives the old value.
- [ ] A PC with 8 GB of memory cannot choose more than 4 GB.
- [ ] Render distance 14 saved with the game closed is 14 in game and stays 14 after the next two Plays; "Back to recommended" returns it to the tier's value and it follows the tier again.
- [ ] A change made in the game's own Options screen shows on the tab when it is next opened, and is not undone by the next Play.
- [ ] With the game open, Save changes nothing in `options.txt`, says so, and the next Play applies it once.
- [ ] Prisoner villagers on: every villager in the spawn village wears the skin, with and without Fresh Animations, blink included (Alex). Off: vanilla villagers again. Another player on the server sees no difference.
- [ ] The cog on the Play tab opens the tab; the website Play choice still works as before.
- [ ] Admin → Installs shows the memory the game got and whether it was chosen.
- [ ] All tests green; `windows-smoke-3.ps1` passes; the self-update from 3.4.2 to 3.5.0 keeps `settings.json`'s `websitePlay`.
