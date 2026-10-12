# 52 · The Mods guide, sectioned by type

Alex, 2026-10-11: the Mods guide needs to be sectioned off by type, like building, mining and so on.

## 1. What changes

`/mods` today has four parts: What's in the game, Helpers, Your extras, Behind the scenes. The first holds every
playable mod in one grid. It becomes a set of sections, one per type. The other three parts stay exactly as they are,
after the type sections, in today's order.

## 2. The types

A new optional field on a mod in `modpack/mods.json`: `topic`. It is the guide's own grouping and has nothing to do
with `category`, which stays the vote's grouping and is not touched. `/pack` does not change.

`GUIDE_TOPICS` in `packages/modpack/src/schema.ts`, in this order. Titles and blurbs live in
`apps/web/src/lib/mods-guide.ts` beside `PARTS`.

| id | Title | Blurb |
|---|---|---|
| `travel` | Getting around | Maps, waypoints and fast travel. |
| `friends` | Friends and survival | Playing with the others, keeping your land and getting your things back when you die. |
| `mining` | Mining and gathering | Getting ore and wood out of the ground faster. |
| `storage` | Storage and moving things | Carrying more, storing more and moving items without carrying them. |
| `building` | Building and decoration | Extra blocks and furniture for making a base look good. |
| `factories` | Factories and power | Machines, power and automation. |
| `farming` | Farming and food | Crops, cooking and meals. |
| `combat` | Combat | Guns and cannons. |
| `bosses` | Bosses and trials | Big fights out in the world. |

Which mod goes where (every mod with `guide: "game"` that is not hidden, switched off ones included, so switching one
on later needs no edit):

- `travel`: xaeros-minimap, xaeros-world-map, waystones
- `friends`: open-parties-and-claims, simple-voice-chat, corpse
- `mining`: veinminer, fallingtree, additional-enchanted-miner
- `storage`: sophisticated-backpacks, pipez, ae2
- `building`: create-deco, copycats, macaws-roofs, macaws-windows, macaws-doors, handcrafted, macaws-furniture,
  macaws-fences-and-walls, macaws-bridges, macaws-paths-and-pavings, macaws-lights-and-lamps, macaws-trapdoors,
  macaws-stairs, another-furniture, supplementaries, rechiseled, rechiseled-create
- `factories`: create, createaddition, immersiveengineering, industrial-foregoing, mekanism, mekanism-generators,
  mekanism-tools
- `farming`: farmers-delight
- `combat`: tacz-1.21.1, vics-point-blank, create-big-cannons
- `bosses`: l_enders-cataclysm, mowzies-mobs, gateways-to-eternity

Lint (`packages/modpack/src/lint.ts`):
- error: a mod that is not hidden and has `guide: "game"` has no `topic`.
- error: a mod has a `topic` and its `guide` is not `"game"`.

## 3. The page

- `guideParts` returns the type sections where the one `game` part was, then helper, extras and behind as today. A
  section's key is `topic-<id>`. Mods keep `mods.json` order inside a section.
- The filter is unchanged: switched on, not hidden, admin-only mods for admins only. A section with nothing in it for
  the viewer is left out, so a player never sees Bosses and trials while its mods are admin-only.
- Each section draws like today's part: title, count, blurb, the two-column card grid. Cards are unchanged.
- Each section's heading has the id `topic-<id>`, with the same scroll margin the cards have so the sticky search does
  not cover it. The `topic-` prefix keeps it clear of mod anchors. `/mods#create` and every other card link work as
  today.
- Under the search box, one row of links, one per section shown, each "Title (count)", in the page's order, followed
  by Helpers, Your extras and Behind the scenes. It uses the site's existing button or tab style, no new look. At
  390 px it wraps or scrolls sideways and the page itself never scrolls sideways.
- Search: a section with no matching card is hidden, as parts are today, and its link in the row is hidden with it.
  With the box empty everything is back.
- The intro text and the page title do not change.

## 4. What does not change

- `category`, the vote, `/pack`, the app and the installer.
- The lock and the pack version: `topic` is text in `mods.json` and is not part of the lock's hash. Confirm it: after
  the edit the out-of-date box asks for no Lock and no Build, and shipping nothing still gives 71 files and
  `d44eb2ba`. If either is not true, stop and report before going further.
- Helpers, Your extras, Behind the scenes, the admins-only badge.

## 5. Tests

`apps/web/tests/mods-guide.test.ts`:
1. Mods with different topics land in their sections in `GUIDE_TOPICS` order, then helper, extras, behind.
2. A section whose mods are all switched off, or all admin-only for a player, is left out. An admin sees it.
3. Order inside a section is `mods.json` order.
4. Against the real `mods.json` as a player: no card is lost. The ids across all type sections equal the ids today's
   `game` part gives.
5. The existing tests keep passing, changed only where they name the `game` part.

`packages/modpack/tests`: the two lint rules in §2, and the real `mods.json` lints clean.

## 6. Done when

- [ ] `deploy/check.sh` passes and CI is green on the PR.
- [ ] On the test site, signed in as a player, at 1280 and 390 px: the sections show in §2's order with the right
      mods, the row of links jumps to each one, the heading is not hidden under the search box, search hides empty
      sections and their links, `/mods#create` still lands on its card.
- [ ] The same as an admin: Bosses and trials shows, with the admins-only badge on its cards.
- [ ] §4's pack check is reported with the numbers seen.
- [ ] docs/11 gets its entry. Say in the report how each line above was checked in the browser, not only by tests.

Not on main until Alex has looked at it on the test site.

## 7. Public repo

Placeholders only. No real names, addresses or ids in code, tests, docs or commit messages. Nothing a player reads
names the season or its mods.
