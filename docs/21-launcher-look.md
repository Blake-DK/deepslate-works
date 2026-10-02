# 21 · The launcher's look

Planner, 2026-10-02. Input for the VPS session: read it, build it in the order of §9, record deviations in `docs/11-status.md`. App version 3.4.0.

## 1. What Alex asked for

"A modern Minecraft look with graphics and designs." The app today (3.3.1) is the 2.0 PowerShell window ported as it was: a light grey window, Segoe UI, a `TabControl`, a flat green button. It works; it looks like a settings dialog. The new look is the one in `branding/launcher/mockup.html` (open it in a browser; it is one file with everything embedded): a dark window on a deepslate texture, a pixel-art banner of the world at spawn across the top, the name in a pixel display face, tabs as a strip under the banner, a bevelled green Play block and a copper Vote block. Everything that is read, not looked at, stays Segoe UI 13 px, so nothing gets harder to read for the friend who has never played modded.

Two things decide the rest:

1. **Nothing of Mojang's goes in.** Not the Minecraft font, not a texture from the game, not the logo, not the launcher's pictures. Everything in `branding/launcher/` was drawn for this server by `make-art.py`; the font is Pixelify Sans under the SIL Open Font Licence (`fonts/OFL-PixelifySans.txt`, which ships with it, §6).
2. **Weak PCs.** No `DropShadowEffect`, no `BlurEffect`, no animation beyond the countdown that exists. Depth comes from solid offset borders (the bevel in §4), which cost nothing. The banner is one 8 KB PNG.

## 2. The pieces in the repo

| File | What | Used for |
|---|---|---|
| `branding/launcher/make-art.py` | Draws everything below with Pillow; fixed seed, a rerun gives the same files | regenerate after a change; never edit the PNGs by hand |
| `hero.png` | 1200×336, the banner: night sky, two ridges of mountains with snow, oaks, the cherry grove right of the middle, grass, earth, deepslate with copper ore, a lit cave mouth bottom left. Pixel art at 4× | the top of the window |
| `deepslate-tile.png`, `deepslate-tile@3x.png` | a 16×16 deepslate tile and the same at 48×48. Tiles seamlessly | the window's ground, tiled at 48 px, 35 % over `#16171A` |
| `play-button.png` | a bevelled green block, 64×64 | not needed if the bevel is drawn in XAML (§4); kept for the mock-up |
| `fonts/PixelifySans-Bold.ttf`, `-Regular.ttf`, `OFL-PixelifySans.txt` | the display face and its licence | titles, tab headers, Play and Vote |
| `mockup.html` | the mock-up, Play view and Vote view | the thing to match |

## 3. Colours

The portal's dark theme (`apps/web/src/app/globals.css`, `[data-theme="dark"]`) plus the deepslate greys from `branding/logo-options/README.md`. One class, `Ui/Theme.cs`, holds every colour as a named `SolidColorBrush` (frozen) and writes them into the window's `ResourceDictionary` as `{StaticResource}` keys. **After this change no hex literal appears anywhere under `installer/app/src/Ui/` or `Extras/ExtrasApp.cs` except in `Theme.cs`**; a test scans for that (§8).

| Key | Hex | Replaces | Where |
|---|---|---|---|
| `Ground` | `#16171A` | `#F6F7F8` window | the window, under the tile |
| `Panel` | `#121316` | white tab area | tab strip, footer |
| `Card` | `#202226` | `#F6F7F8` / `#EEF0F2` / `#FAFBFC` boxes | ServerBox, question cards, extras cards, "Since last time" |
| `Card2` | `#262930` | `#EEF4F8` HeadlineBox | the Update button face, raised cards |
| `Line` | `#33363C` | `#D9DDE1`, `#C9CED3` | borders, dividers |
| `Fg` | `#EBE9E4` | black / `#444` | body text |
| `Muted` | `#A09D95` | `#555`, `#666`, `#777` | secondary text, hints |
| `Dim` | `#6F6D66` | `#888`, `#999`, `#A0A7AE` | footer, timestamps |
| `Copper` | `#E8833A` | `#C0661F` tagline | tagline, tab underline, Vote button, badge, "update available" |
| `CopperHi` | `#FFB26B` | | tagline on the banner, bevel highlight on Vote |
| `CopperLo` | `#B8652C` | `#B26A00`, `#8A5A00` | bevel shadow on Vote, warnings |
| `Green` | `#2E7D5B` | the same | Play face, "done" text |
| `GreenHi` | `#3A9A70` | | Play bevel highlight, the server dot when up |
| `GreenLo` | `#1F5C42` | | Play bevel shadow, Play text shadow |
| `GreenText` | `#8FD4B3` | `#2E7D5B` on text (PlayChanged, ok rows) | green text on dark cards (the solid green fails contrast on `#202226`) |
| `Blue` | `#6AA7E6` | `#1A5FB4`, `#E3F0FF` | links, StepLabel, VoteStep |
| `Red` | `#E5484D` | `#B3261E`, `#FDECEA` | errors |
| `Amber` | `#F2B35C` | `#FFF4E0` / `#8A5A00` "later" rows | waiting / later |
| `Disabled` | `#3E444D` | | a shut Play button's face |
| `DisabledText` | `#A09D95` | | its text |

Light tinted boxes (`#E8F3EE` ok, `#FFF4E0` later, `#FDECEA` failed) become `Card` with a 3 px left stripe in `GreenText` / `Amber` / `Red`: the tone is in the stripe, the box is the same card as everything else. Contrast: every text/background pair above is at least 4.5:1 (`Muted` on `Card` is 5.9:1, `Dim` on `Panel` 4.6:1, `Blue` on `Card` 6.3:1, `GreenText` on `Card` 9.1:1); check anything you add with the same bar.

## 4. The window, piece by piece

Same `Window` (600×740, MinWidth 560, MinHeight 560), still one XAML string parsed at run time, **every `x:Name` in `AppWindow.Names` kept** so `AppUi` and the tests are unchanged. New names are added to `Names`.

**Ground.** `Window.Background` is a `Grid` background of two layers: a `Rectangle` in `Ground`, then a `Rectangle` filled with an `ImageBrush` of `deepslate-tile@3x.png`, `TileMode="Tile"`, `Viewport="0,0,48,48"`, `ViewportUnits="Absolute"`, `Opacity="0.35"`, `RenderOptions.BitmapScalingMode="NearestNeighbor"`. The tile is already 48 px so even a smoothed draw is sharp.

**Banner** (`Hero`, a `Grid`, `DockPanel.Dock="Top"`, height 160; 110 when the window is under 660 px tall, set in `SizeChanged`):
- `HeroImage`: `hero.png`, `Stretch="UniformToFill"`, `StretchDirection="Both"`, aligned bottom, `NearestNeighbor`.
- a `Rectangle` over it with a `LinearGradientBrush` top→bottom, transparent at 40 % to `#D90A0C10` at 100 %, so the text at the bottom reads on any part of the picture.
- a 3 px bottom border in `Copper`.
- `BrandBar` moves in here, bottom left, margin 18,0,0,14: `BrandLogo` 48×48 (the branding logo when `logo.png` is in the home folder, pixel or smooth per the marker as today; otherwise `LogoFallback`, a drawn tile: a 48 px `Border` in a `#3E444D→#23272D` gradient, 2 px `#565C66` border, with a "D" in Pixelify Sans Bold 22 in `Copper`). `BrandName` in Pixelify Sans Bold 30, white, with a 3 px `#1C1F24` offset shadow drawn as a second `TextBlock` behind it (not an effect). `BrandTagline` 12.5 px in `CopperHi`. `BrandBar` is always visible now (it was collapsed until a logo was picked); the name comes from the branding block when there is one, else "Deepslate Works".
- `HeroStatus`, top right (margin 0,14,16,0): a pill (`Border`, CornerRadius 999, background `#C70C0D10`, 1 px `Line`, padding 9,5,11,5) with `HeroDot` (9 px `Ellipse`) and `HeroLine` (12 px SemiBold). It mirrors `ServerDot`/`ServerLine`: whatever `AppUiHome` writes to those it also writes here, shortened: "Server is up · 2 playing", "Server is asleep", "Waking, about 30 s", "Can't reach the site". `HeroDot` is `GreenHi` when up, `Copper` while waking, `Dim` asleep or unknown, `Red` when the site can't be reached. No glow (that would be an effect); the colour is enough.

**Tabs.** The `TabControl` stays (`Tabs`, `PlayTab`, `VoteTab`, `ExtrasTab`, `LogTab`), restyled with a `ControlTemplate` in the resources: a `TabPanel` strip on `Panel` with a 1 px `Line` under it, margin 0, the content below with no border and no padding of its own. `TabItem` template: header text in Pixelify Sans Bold 16, `Muted`, padding 14,10,14,8, a 3 px bottom border transparent; selected: white text, `Copper` border. No focus rectangle, no chrome. `VoteTab`'s header gets `VoteBadge`, a small `Border` (`Copper`, CornerRadius 3, padding 5,0) with white 12 px text for the number of polls waiting, hidden when none. Header text loses the "  Play  " padding spaces (the template pads).

**Play tab.** The same elements in the same order, in cards:
- `ServerBox` becomes a `Card` with a 1 px `Line` border, CornerRadius 4, padding 12,10. Its first line (`ServerLine`, SemiBold) reads as the card's title; `SiteLink` stays on the right of that line. `ServerOnline` gets `OnlineHeads`, a horizontal `StackPanel` of 24 px pictures before the text (§7, optional, placeholders until then). `NewsBox` stays inside, divider in `Line`.
- `PlayChanged` ("Since last time: …") moves into its own `Card` under the server card, `GreenText` SemiBold, with its detail line (`PlayChangedDetail`, new, `Muted`) listing what changed; `AppUiHome` already has the words, it writes them here instead of appending to the same `TextBlock`.
- `PlayBody` (progress rows, question cards, guided setup) keeps its content; the cards it builds in `AppUi` use `Card`, `Line` and the stripe rule of §3.
- The bottom row is unchanged in layout: links left (`ReviewLink`, `SettingsLink`, in `Blue`), `PlayButton` + `UpdateButton` right, `PlayHint` and `UpdateLine` under them.

**Buttons.** Two styles, both plain `ControlTemplate`s with no `ButtonChrome`:
- `Primary` (Play, Vote, Start, Apply, Yes, Done, Continue): a `Grid` of three `Border`s. Outer: 2 px `#000`, no radius. Face: the fill (`Green`, or `Copper` for Vote). Bevel: a `Border` with `BorderThickness="2,2,0,0"` in the Hi colour and another with `BorderThickness="0,0,2,3"` in the Lo colour, both over the face. A 3 px `#000` strip under the whole thing (a `Border` margin 0,0,0,-3 at the bottom, or a 4th border) is the block's drop. Text white; Play and Vote in Pixelify Sans Bold 24 / 20 with a 2 px Lo-colour offset shadow (a second `TextBlock`), letter spacing 1; the smaller primaries (Start, Apply, Yes, Done) keep Segoe UI SemiBold 13. Pressed: Hi and Lo swap and the content moves 1,1. Disabled: face `Disabled`, text `DisabledText`, bevel in `Line`. Hover: face 6 % lighter (`GreenHi` at 50 % over it is fine). Play keeps MinWidth 190; Vote 150.
- `Plain` (Update, Allow all, Reset all, Check extras, Later, Cancel): the same construction with face `Card2`, Hi `#3E444D`, Lo `Panel`, text `Fg` SemiBold 13. Update's three states keep their words ("✓ Up to date", "● Update", "Updating…"); the ✓ and ● are in `Copper`.

Width check (there is a test for this since 3.3.1): Play 190 + 8 + Update 118 at the new 2 px borders is 2 px wider each; the row still fits at MinWidth 560 with the links. Keep the test, update its numbers.

**Vote tab.** `VoteStep` in `Blue` 12 px upper-case ("THERE'S A NEW VOTE · closes Sunday 20:00 UK"), `VoteTitle` in Pixelify Sans Bold 22 (wrap, max 3 lines; past that fall back to Segoe UI SemiBold 20 so a long question is still readable), `VoteNote` `Muted`. Each option that `AppUiHome` builds in `VoteBody` is a `Card` (`Opt`): a 16 px square check box drawn as a `Border` (2 px `#565C66`, fill `#1C1F24`, a ✓ in `CopperHi` when picked), the option's picture at 36×36 when it has one (a mods.json entry's icon or the poll's picture, `NearestNeighbor` if the branding says pixel, else smooth), the text in `Fg` SemiBold with the description under it in `Muted` 12 px. Picked: 1 px `Copper` border plus a 1 px inner `Copper` border (two borders, no effect). "I don't mind" is a card with the box and the text only. `VoteButton` is `Primary` in copper, 150 wide. `VoteError` in `Red`.

**Extras tab.** Title "Extras" in Pixelify Sans Bold 20; the intro `Muted`; `HeadlineBox` a `Card2` card; each extra's row a `Card`; `ChecksTitle` Pixelify 15. `ProgressBox` rows as today in the new colours.

**Log tab.** `LogList` on `Panel`, Consolas 12 in `Muted`, the last line in `Fg`. The first two lines the app logs at start gain one: "Fonts: Pixelify Sans, SIL Open Font Licence (see licences in the app folder)" (§6).

**Footer.** On `Panel` with a 1 px `Line` top border, padding 16,8,16,10, 11.5 px, `Dim`, the values (`FooterApp`, `FooterPack`, `FooterServer`) in `Muted`; "Pack update available" in `Copper` (replaces `#B26A00` in `Footer.Parts`, which now returns the key name `"Copper"` or `"Dim"` as `PackTone`, looked up in `Theme`).

**The question window (`AskXaml`), the settings window (`SettingsXaml`), the restart question.** Dark too: background `Card`, the same `Primary` / `Plain` styles (they get their own copy of the resources, since each is parsed on its own; put the shared resource XAML in one string, `AppWindow.ThemeXaml`, and splice it into all three), `Q`/`SQ` in Segoe UI SemiBold 16 (a question is read, not looked at), the notes `Muted`.

**First-run and guided setup.** The cards `ShowFirstRun` and `ShowGuidedStep` build get the same treatment through `Theme`; the step label (`StepLabel`) in `Blue`. No other change: the words and the order stay.

## 5. Where the pictures and the font live at run time

Embedded in the exe as manifest resources (the csproj already does this for the icon with `EmbeddedResource`; add `hero.png`, `deepslate-tile@3x.png`, `PixelifySans-Bold.ttf`, `PixelifySans-Regular.ttf`, `OFL-PixelifySans.txt` from `..\..\branding\launcher\` with `LogicalName`s `assets/<file>`). Do **not** switch the project to `UseWPF` / `<Resource>` items for this: the project compiles no XAML and the pack URI route needs the WPF targets, which is a build change for its own sake.

At start, `Home/Assets.cs` (new) writes them to `<AppHome>\assets\` when the folder is missing or `assets\version.txt` is not this exe's version (so an update refreshes them; an unchanged version costs one file read). The window then loads:
- pictures with `new BitmapImage(new Uri(path))` with `CacheOption = OnLoad` (so the file is not held open);
- the font with `new FontFamily(new Uri(Env.AppHome + "\\assets\\"), "./#Pixelify Sans")` set as a resource `PixelFont`; the XAML uses `FontFamily="{StaticResource PixelFont}"`. If the folder write fails (a read-only home, antivirus) the resource falls back to `Segoe UI` and the app logs "Pixel font not available: <why>"; nothing else changes. This is the fallback the tests exercise.

The assets folder is removed by the uninstaller with the rest of the home folder (`Home/Uninstaller.cs` already takes the folder; check it does not list files by name).

## 6. Licence

Pixelify Sans is © 2023 The Pixelify Sans Project Authors (github.com/eifetx/Pixelify-Sans), SIL Open Font Licence 1.1. The OFL lets us embed and ship it provided the licence text travels with it: it is in the repo next to the font, in the exe as a resource, written to `assets\` with the font, and named once in the Log at start. `installer/README.txt` gets two lines saying so. The font is not renamed and not modified.

## 7. Player heads (optional, after the look is in)

`ServerOnline` says who is in the world. A 24 px head next to each name is the one detail that makes it look like a Minecraft thing rather than a list. The app talks to our site only, so the site serves them: `GET /api/app/head/<uuid>.png` in `web` (the api is in the tunnel and never fetches the internet), which fetches `https://crafatar.com/avatars/<uuid>?size=24&overlay` once a day per uuid, caches it under `data/heads/`, and answers a 24×24 PNG; on any failure a built-in 24×24 pixel placeholder (a grey head, drawn in `make-art.py` as `head-placeholder.png`). Members' uuids are known from the Minecraft link (docs/14). In the app, `OnlineHeads` shows the placeholder immediately and swaps in the fetched head when it arrives; a failure keeps the placeholder and logs once. `GET /api/app/home` adds `online[].uuid` so the app knows which head to ask for. Skip this section entirely if it does not fit the session; the look is done without it.

## 8. Tests

In `installer/tests/DeepslateWorks.Tests`, on the windows runner as today:

- `ThemeTests.cs`: every key in §3 exists in `Theme` and is frozen; no six-digit hex literal appears in any `.cs` under `src/Ui/` or in `src/Extras/ExtrasApp.cs` other than `Theme.cs` (read the sources from the repo path the tests already know for `AppXaml`); every text/background pair in a table in the test is ≥ 4.5:1 by the WCAG formula.
- `UiTests.cs`: every name in `Names` is found (the existing test, with the new names); the window's background has the tile brush; the hero is 160 at 740 tall and 110 at 600 tall; `BrandBar` is visible with no logo and shows `LogoFallback`; with a `logo.png` in a temp home it shows the picture and hides the fallback; `HeroLine` follows `ServerLine` for up / asleep / waking / unreachable with the dot colours of §4; the Vote badge shows "2" with two polls waiting and is hidden with none.
- `AssetsTests.cs`: a fresh temp home gets `assets\` with all five files and `version.txt`; the same version writes nothing (mtimes unchanged); a changed version rewrites; a home folder made read-only gives the Segoe UI fallback and one log line, and the window still opens.
- `ReviewTests.cs` row-width test: numbers updated for the 2 px borders, still passing at MinWidth 560.
- `-Screenshots`: pictures 22 onwards: `22-play-ready`, `23-play-updating`, `24-play-server-asleep`, `25-vote`, `26-extras`, `27-question-card`, `28-min-size-560x560`. CI uploads them as today. **The look is unverified until Alex opens it on Windows**; say so in docs/11.

## 9. Order of work

1. `Theme.cs` and `ThemeXaml`, the two button templates, the dark `AskXaml` / `SettingsXaml`. Replace every hex literal. Tests: `ThemeTests`. Nothing moves yet; the window is dark and the buttons are blocks. Screenshot it.
2. `Assets.cs`, the embedded resources, the font with its fallback. Tests: `AssetsTests`.
3. The ground, the banner with `BrandBar` and `HeroStatus`, the tab strip, the footer. Tests: `UiTests` additions. Screenshots 22 to 24, 28.
4. The Play tab's cards, the Vote tab's option cards and badge, the Extras tab, the Log tab. Screenshots 25 to 27.
5. `README.txt`, the Log line, `docs/07` gets a short "3.4.0: the look" entry pointing here, `docs/11` the state, `installer/VERSION` 3.4.0. PR.
6. §7 heads, if it fits, as its own PR (it touches `web`).

## 10. Acceptance

- [ ] The window matches `mockup.html` by eye in both views (Alex, on Windows), at 600×740 and at 560×560.
- [ ] No hex literal outside `Theme.cs`; every pair in the contrast table passes.
- [ ] The banner, tile and font come from `branding/launcher/`; nothing from Mojang; the OFL text ships and is named in the Log.
- [ ] A read-only home folder still opens the app, in Segoe UI, with one log line.
- [ ] Every existing test passes unchanged except the width numbers in `ReviewTests`.
- [ ] The app on a weak PC: no effect classes (`DropShadowEffect`, `BlurEffect`) anywhere in `src/`; a grep in `ThemeTests` enforces it.

## 11. 3.4.1: landscape, and clearer text (planner, 2026-10-03, after Alex saw 3.4.0 on his PC)

Alex's two notes on 3.4.0: the window should be wider than it is tall, and the text is not clear enough. `branding/launcher/mockup.html` is updated to this layout; match it.

**Landscape.** `Window` 980×620, MinWidth 900, MinHeight 560 (a 1366×768 laptop still fits it with the taskbar). The banner `Hero` is 128 px, always (drop the 160/110 rule), with the picture aligned so the ground line sits in its lower third (`Stretch="UniformToFill"`, `VerticalAlignment="Bottom"` is enough with the 300×84 source). `BrandName` 32, the tagline 13, the status pill 13.

The Play tab's body is a two-column `Grid` (columns `340` and `*`, rows `*` and `Auto`, gap 16 across and 12 down):
- Left column, top to bottom: `ServerBox` (the server line as the card's title, SemiBold 14, wrapping; "Open the site" on its own line under it as a link, not on the right; `OnlineHeads` + `ServerOnline`; `NewsBox`), then `ChangedBox`. Both fill the column's width; the column scrolls only if it must.
- Right column: `PlayTitle` (Segoe UI SemiBold 20, no longer the display face), `PlayStatus` (`Muted`), then `PlayBody` in a `Card` that fills the rest of the row (`ScrollViewer` inside it, as today). The question cards, the guided setup and the Review view render in this right column with the left column kept.
- Bottom row, spanning both columns: `ReviewLink` and `SettingsLink` side by side on the left (gap 18, vertically centred on the buttons), `PlayButton` + `UpdateButton` right, `PlayHint` and `UpdateLine` under them, as today.

Vote tab: one column; the options in a two-column grid of cards when the window is 900 or wider (they already wrap in `VoteBody`; a `UniformGrid Columns="2"` or a `WrapPanel` with cards at half the width), `VoteButton` bottom right. Extras tab: the extras' rows in the same two-column grid; the headline and the checks full width. Log tab unchanged.

Screenshots (`-Screenshots`): 22 to 28 are retaken at 980×620; add `29-min-size-900x560`.

**Clearer text.** Three causes in 3.4.0, three fixes:
1. *The pixel face is used where it is too small to be crisp* (the tabs at 16, "Ready to play" at 20, the vote question at 22). Pixelify Sans only where it is big: `BrandName` (32) and the Play and Vote blocks (24 and 22). Tabs, `PlayTitle`, `VoteTitle`, the Extras title, `ChecksTitle` and every other heading go back to Segoe UI SemiBold (tabs 14, titles 20, Checks 15). The two keep-the-face-up-to-N-characters rules of 3.4.0 go with it: the Play and Vote blocks keep the face for their short labels ("Play", "Vote", "Update", "Continue"); a long label ("Vote first, it takes ten seconds") is Segoe UI SemiBold 15, as 3.4.0 already does.
2. *Rendering.* On the window: `TextOptions.TextFormattingMode="Display"`, `TextOptions.TextRenderingMode="ClearType"`, `UseLayoutRounding="True"`, `SnapsToDevicePixels="True"`. On the three elements that use the pixel face: `TextOptions.TextRenderingMode="Aliased"`, so its pixels stay square instead of being smoothed into grey. Every `Image` of pixel art already has `NearestNeighbor`; the two drawn text shadows (the name, the Play label) stay 2 and 3 px offsets in solid colour.
3. *Contrast.* Body text goes from 13 to 14 px and the greys come up: `Fg` `#F2F0EB` (was `#EBE9E4`), `Muted` `#B5B2AA` (was `#A09D95`; 8.6:1 on Card), `Dim` stays `#908D85` (3.4.0's measured value). The status pill's text is `Fg`. `ThemeTests`' contrast table takes the new values.

Nothing else changes: the words, the order of the steps, the tests' names. Version 3.4.1. Acceptance: the window matches the updated mock-up by eye at 980×620 and 900×560 (Alex); every text/background pair passes 4.5:1; the pixel face appears in exactly three places (a `LookTests` check walks the tree); `windows-smoke-3.ps1` still passes.
