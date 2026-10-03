# 23 · The site's look

## 1. What Alex asked for

"Build a design so the website looks like the launcher." The site today is a light or dark shadcn-style page with a sidebar. It should read as the same thing as DeepslateWorks.exe 3.4.1 (docs/21-launcher-look.md, §11 included): the deepslate ground, the pixel-art banner with the name on it, a copper line, a tab strip, cards on the ground, a bevelled green Play block and a copper Vote block. Everything in docs/21 §1 holds here too: nothing of Mojang's, no effects that cost a weak PC or a phone anything.

## 2. Pieces

All from branding/launcher/, copied into apps/web/public/brand/ by a small script or by hand (keep make-art.py the only source, never edit the PNGs):
- hero.png (1200×336), the banner.
- deepslate-tile@3x.png (48×48), the ground.
- head-placeholder.png, already used by player heads.
- fonts/PixelifySans-Bold.ttf with OFL-PixelifySans.txt next to it. Self-host it with @font-face (font-display: swap), weight 700 only. No request to Google Fonts. Name the licence once on the Getting started page's foot or in the version footer's title.

## 3. Colours

One theme. The light theme and the theme toggle go (components/theme-toggle.tsx, the data-theme attribute, the dark custom variant). In apps/web/src/app/globals.css the tokens become, on :root, with color-scheme: dark:

| Token | Hex | Launcher key |
|---|---|---|
| --background | #16171A | Ground |
| --panel (new) | #121316 | Panel |
| --card | #202226 | Card |
| --card-2 (new) | #262930 | Card2 |
| --muted | #262930 | Card2 |
| --border | #33363C | Line |
| --foreground, --card-foreground | #F2F0EB | Fg |
| --muted-foreground | #B5B2AA | Muted |
| --dim (new) | #908D85 | Dim |
| --primary, --ring | #E8833A | Copper |
| --primary-hi (new) | #FFB26B | CopperHi |
| --primary-lo (new) | #B8652C | CopperLo |
| --primary-foreground | #16171A | OnCopper |
| --play (new) | #2E7D5B | Green |
| --play-hi (new) | #3A9A70 | GreenHi |
| --play-lo (new) | #1F5C42 | GreenLo |
| --accent | #8FD4B3 | GreenText |
| --info | #6AA7E6 | Blue |
| --warn (new) | #F2B35C | Amber |
| --danger | #F06A6E | Red |
| --disabled (new) | #3E444D | Disabled |
| --disabled-foreground (new) | #BDBAB3 | DisabledText |

Add each new token to the @theme inline block. Fonts: --font-sans "Segoe UI", system-ui, -apple-system, Roboto, sans-serif; --font-display "Pixelify Sans", "Segoe UI", sans-serif; --font-mono Consolas, ui-monospace, monospace. Body text 15 px, line height 1.5. Every text and background pair at 4.5:1 or better; white on Copper fails, so anything on Copper is #16171A.

## 4. The frame (components/nav.tsx, AppFrame)

Top to bottom, the same for every signed-in page:

- **Ground.** body background --background with deepslate-tile@3x.png tiled at 48 px over it at 35 % (a fixed pseudo-element, image-rendering: pixelated, pointer-events none).
- **Banner.** A header 176 px tall (150 under 640 px wide). hero.png as a cover image, object-position center 70 %, image-rendering: pixelated. Over it a gradient from transparent at 35 % to rgba(10,12,16,.85) at the bottom. A 3 px Copper bottom border. Inside a max-w-6xl container: bottom left the brand block, a 48 px logo (the uploaded logo when there is one, pixelated per the branding marker as today; otherwise the drawn tile, a #3E444D to #23272D gradient with a 2 px #565C66 border, an inset 2 px #1C1F24 ring and a "D" in the display face 24 in Copper), the name in the display face 34 px white with a 3 px 3 px 0 #1C1F24 text shadow (26 px under 640), the tagline 13 px in CopperHi. Top right the status pill: rgba(12,13,16,.8), 1 px Line, fully round, 13 px semibold, a 9 px dot and the short line the app uses ("Server is up · 2 playing", "Server is asleep", "Waking, about 30 s", "Can't reach the site"). Dot colours: up GreenHi, waking Copper, asleep or unknown Dim, unreachable Red. It keeps data-testid="nav-status" and the full line and hint as its title.
- **Tab strip.** Replaces the sidebar and the mobile drawer. On Panel with a 1 px Line under it, one row in the same container, overflow-x: auto, white-space: nowrap. Links in today's order: Home, Map, Getting started, Mods guide, Players (or Players & stats), Mods & vote, Votes, Activity, then a spacer, then Control Room (admins only, text in CopperHi), Me, Sign out. Each link: semibold 15, Muted, padding 13 14 10, a 3 px transparent bottom border; the current one white with a Copper border and aria-current="page". Badges ("vote", the number of polls waiting) are a Copper chip with #16171A text, 12 px, 3 px corners. No group labels.
- **Admin strip.** apps/web/src/app/(app)/admin/layout.tsx puts a second strip of the same construction under the first: Control Room, Server, Pack, People, News, Site settings. components/tabs.tsx takes the same style, so tabs inside a page look the same.
- **Main.** max-w-6xl, padding 26 20 34.
- **Footer.** components/version-footer.tsx on Panel with a 1 px Line top border, 12.5 px, Dim with the values in Muted, tabular figures: Site <commit> · Pack <version> · App <version> · Server <state>. The server value is Copper when it is not up.
- **Signed out and not yet onboarded.** The same banner and footer, no tab strip. The login page: banner 260 px tall, then a 440 px column with the Sign in card ("Continue with Discord" as a full-width green block in Segoe UI semibold 16, the email form behind its details as today, fields per §5) and "Not in the group yet? You need an invite link from Alex." under it. The uploaded banner picture, when there is one, replaces hero.png in the banner on every page.

## 5. Parts (components/ui/)

- **Button.** Square corners. Every variant is a block: a 2 px #000 border, box-shadow inset 2px 2px 0 <Hi>, inset -2px -3px 0 <Lo>, 0 3px 0 #000, and 3 px of bottom margin for the drop. primary: face --play, Hi --play-hi, Lo --play-lo, white text. A new variant "copper" (Vote now, Vote): face --primary, Hi --primary-hi, Lo --primary-lo, text #16171A. secondary: face --card-2, Hi #3E444D, Lo --panel, text Fg. danger: face --danger, Hi #F7A3A5, Lo #B3383C, text #16171A. ghost stays a plain text button. Disabled: face --disabled, text --disabled-foreground, both bevels Line, no opacity change. Hover: the face 6 % lighter. Active: Hi and Lo swap and the label moves 1 px down and right. Focus: a 2 px Copper outline with a 2 px offset. Sizes: sm 36 px tall, md 44, lg 50; text semibold 15.
- **The Play block** (components/server/play-button.tsx) and **the Vote block** (the poll's submit in components/polls/poll-card.tsx): the display face, Play 26 px white on green with a 2 px 2 px 0 --play-lo text shadow and min-width 190, Vote 24 px #16171A on Copper and min-width 150. A long label ("Vote first, it takes ten seconds", "Update, then play") is Segoe UI semibold 15, as the app does. These two and the name in the banner are the only uses of the display face; a test checks it (§7).
- **Card.** Card on a 1 px Line, 4 px corners (rounded-xl goes), no shadow, padding 16 18. Titles semibold 18. A card that wants attention (an open vote, the vote banner) gets a 2 px Copper edge in place of today's border-primary.
- **Badge.** A Card2 chip with a 1 px Line, 3 px corners, 13 px semibold, the tone in the text: good GreenText, warn Amber, bad Red, info Blue, neutral Muted, and Copper for waking.
- **Alert.** Card with a 3 px left stripe in the tone (GreenText, Amber, Red, Blue), as docs/21 §3.
- **Input, select, textarea.** 44 px tall, Panel fill, a 2 px #565C66 border, square, Fg text; focus turns the border Copper. Labels 13 px semibold.
- **Checkbox and radio** in the ballot and polls: a 16 px square, 2 px #565C66, fill #1C1F24, a ✓ in CopperHi when picked. A picked option card gets a 2 px Copper edge.
- **Vote page.** The step line in Blue 12 px semibold upper-case ("THERE'S A NEW VOTE · closes Sunday 20:00 UK"), the question semibold 24, the note Muted, options as cards two to a row from 760 px wide and one below it, each with the box, a 36 px picture when it has one, the name semibold and the description 13.5 in Muted. "Play opens as soon as you've voted." left of the Vote block.
- **Home.** Order and words unchanged. The server card: title with its badge, the line semibold, the address in the mono face, players as Card2 chips with their 24 px head, the three figures, the sparkline in Copper on a Panel box. The memory bar is a square Panel track with a Copper fill.
- **Everything else** (mod cards, the inventory grid, analytics tiles, the live console, the event list): takes the tokens and the parts above with no layout change. Charts use Copper for the main series, Blue for a second, Line for grid lines.

## 6. What does not change

Words, routes, data-testid values, the order of things on a page, who sees what. No new dependency. No animation beyond what exists.

## 7. Tests

- A test reads globals.css and fails if a token of §3 is missing or its hex differs.
- A test scans apps/web/src for a six-digit hex literal outside globals.css and the brand components named in §4 (the logo tile, the banner gradient) and fails on any other.
- A test scans for the display face: font-display may appear only in the banner name, the logo tile, the Play block and the Vote block.
- A contrast table as in ThemeTests.cs, every pair at 4.5:1.
- Existing tests pass unchanged; the ones that look for the sidebar or the Menu button move to the tab strip (role navigation, name "Main").
- No screenshot run on the VPS. Say in docs/11 that the look is unverified until Alex opens it.

## 8. Order of work

1. Tokens, fonts, the pictures in public/brand/, the light theme and its toggle removed. Button, Card, Badge, Alert, Input. Tests of §7. One PR: the site is dark and blocky, the frame unchanged.
2. The frame: ground, banner, status pill, tab strip, admin strip, footer, the signed-out frame and the login page. One PR.
3. Home, Votes, the poll card, the ballot's boxes, the Play block. One PR.
4. A pass over every other page for leftovers (rounded corners, tinted boxes, anything still reading a removed token). docs/11, ROADMAP.md.

Never build images on the VPS; push, let CI build, then deploy/deploy.sh.

## 9. Acceptance

- [ ] Home, Votes and Sign in match the planner's design by eye at 1360 px and at 390 px (Alex).
- [x] One theme; no toggle; no hex literal outside globals.css and the brand components. *(2026-10-03: `site-look.test.ts` "no light theme, no dark variant and no toggle left" and the hex scan, with the exceptions listed in docs/11 deviation 4, unchanged through step 4.)*
- [x] The display face in exactly the places §5 names. *(2026-10-03: the display-face scan: nav.tsx, play-button.tsx, poll-card.tsx only.)*
- [x] The tab strip holds every link the sidebar held, scrolls sideways on a phone and never wraps to two rows. *(2026-10-03: the frame test checks the links and their order, `overflow-x-auto whitespace-nowrap`; frame-test.sh on the live site: all 16 strip pages render with it. Scrolling on a real phone is part of Alex's look by eye.)*
- [x] Every pair in the contrast table passes. *(2026-10-03: the contrast table in `site-look.test.ts`, every pair at 4.5:1 or better, hover faces included.)*
- [x] Every existing data-testid still resolves. *(2026-10-03: all 113 `data-testid` values in apps/web/src before step 1 (a678655^) are still in the source after step 4; frame-test.sh finds the frame's on every page.)*
