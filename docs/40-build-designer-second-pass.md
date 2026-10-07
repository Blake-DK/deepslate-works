# 40. The build designer, second pass: any name, designing in the background, better builds (plan, Alex 2026-10-07)

## Context

docs/39 is built and Alex has used the card. His words, the same day: "when I enter a name for the design it needs
to accept anything and then change it to the correct format, it also needs to continue working even if I'm not on
the tab, the designs are way too simple and boring."

Three parts, in the order to build them. Parts 1 and 2 are small and certain. Part 3 is the one that matters and is
tested from a terminal before it is deployed.

## What the planner found (2026-10-07, in a copy of `dev` at `2f2d915`)

- **The name.** The box has `pattern="[a-z0-9_]{2,24}"` and `designAction` refuses anything else. "Boss Temple" is
  turned away.
- **Leaving the page.** The card waits on one server action for up to seven and a half minutes and keeps what it
  is doing in the component. Leave the page and that is gone: the card comes back as an empty form and nothing
  says a design is on its way. Whether the action itself always runs to its end after the page is left is not
  proven either.
- **The builds.** The three in `modpack/designer/examples/` are a box with a pyramid on it, a ring and a square
  tower. `tools/designer/instructions.md` has rules for doors, lights and foundations and **not one line about how
  a build should look**. The designer did what it was told.
- **The recipe language is not the main limit.** The planner wrote the same temple by hand in the language as it
  is today, with no new step: a hall with side aisles under lean-to roofs, a gabled porch on four columns, a round
  window, buttresses, a tower behind with a dome and corner lights, a patterned floor, the portal on a raised floor.
  199 steps, 17.5 KB, compiled the first time. It is `temple_b.json`, handed over with this plan. So the first fix
  is direction, not code.
- **The picture hides detail.** Stairs, slabs, walls, fences and panes are drawn as whole cubes, so a stair roof
  and a flat one look alike.
- **The picture is wrong at some sizes.** `render` takes any even `tile` but its rows step by `tile / 4`. With a
  tile of 6 or 10 that is half a pixel, the pixel's place in the array is no longer whole and half the blocks land
  250 pixels to one side. The card asks for `floor(720 / (x + z) / 2) * 2`, which is 6 or 10 for builds whose x and
  z add up to 60 to 71 or 90 to 119. `modpack design` has the same sum with 1000. Square builds of 41 and 37 missed
  it by luck.

## Part 1: any name

- One helper, `designName(typed, ask)` in `apps/web/src/lib/designer.ts`, used by the card (to show the result as
  it is typed) and by `designAction` (which never trusts the card):
  - small letters; accents taken off; every run of anything that is not a letter or digit becomes one `_`; no `_`
    at either end; cut to 24 and trimmed again;
  - nothing left or one character: made from the first three words of the ask that are longer than two letters;
    still nothing: `build`;
  - for a new design, a name that a design or an upload already has gets `_2`, `_3` and so on, cut to fit.
- The box loses its `pattern` and `required`. Under it, as he types: "Saved as `boss_temple`". An empty box is
  allowed: the name comes from the ask.
- What he typed is kept as `title` in the design's file (60 characters at most) and is the heading on the card,
  with the file's name beside it. Designs made before this have no title and show the name.
- The same helper on the Builds card's upload name and Capture's name (docs/37), which refuse the same way today.

## Part 2: a design carries on by itself

- **Design** and **Change it** answer at once. The action does its checks, writes
  `data/builds/designs/<name>.job.json` (`{ name, title, ask, fresh, by, startedAt, boot, stage }`) and returns.
  The work (the call, the one send-back, the check, the version written) runs after the answer has gone, with
  `after` from `next/server` if that is proven to outlive the response and a move to another page here; a promise
  held at module level if it is not.
- **One job at a time.** The designer takes one call at a time anyway. A second start is refused with "The
  designer is working on boss_temple, started 14:02."
- **`stage`** is `designing`, `fixing` (sent back once) or `checking`, written as it changes.
- **When it ends:** the version is in the design's file and the job file is gone. On a failure the job file stays
  as `{ ..., failed: "<why>", text?, finishedAt }` until the next start or until he presses "Clear".
- **A job this process did not start is dead.** `boot` is a random id made when `web` starts. A job file with
  another `boot` (the site restarted mid-design) is shown as failed: "The site restarted while it was designing.
  Start it again." So is one older than 12 minutes.
- **The card** gets the job with the page, so opening Admin → Seasons mid-design shows "Designing boss_temple…
  started 14:02, 1 min 40 s", with both forms off. While a job runs it asks `GET /api/admin/designer/job` (owner
  only) every 5 seconds when the tab is seen and once when the tab comes back. When the job is gone it loads the
  design and shows it; when it failed it shows why. The browser tab's title gains "✓ boss_temple is ready" until
  the card is looked at.
- **Admin → Seasons' other cards and every other page work while a design runs.** That is the test.
- The limits still count `build.design` events. The designer's own time limit goes from 420 s to 600 s and web's
  wait to 630 s: nobody is watching a spinner any more and Part 3 asks for more work per call.
- **Open, for Alex:** a line in the admin Discord channel when a design is ready. Not built unless he asks.

## Part 3: better builds

### 3a. New instructions (no new code but the `plan` field and two numbers)

- `tools/designer/instructions.md` is replaced by the file handed over with this plan. What changes:
  - **"How to design" is about looks**, in the order a builder works: the shape (a main body and at least two more
    parts of another height, never one rectangle against the sky), roofs (pitched, of stair blocks, overhanging, eave
    and ridge in a second material), depth (nothing flat for more than 7 blocks, corner piers, walls in three bands
    by height), openings (rows of tall windows with rounded tops and sills, a door made much of), the inside (a
    floor pattern, piers, a raised floor, lights that hang), the ground. Mixes only on wall faces and paving, never
    on a roof. "If the admin says it is boring, do not swap materials: add parts, roofs and depth."
  - **"How to make things"**: twelve ways to get a shape out of the steps as they are, each with a few steps that
    compile (the planner compiled all 29 of them): a pitched roof from slanting lines of stairs, a gable, a lean-to,
    an arch, a column with a base and a head, a buttress, a window with a sill, a banded wall, a round window, a dome
    on a drum with a spire, battlements, a hanging light, a light on a bracket, a floor pattern.
  - **The answer gains `plan`**, a list of the build's parts, written before the recipe so the shape is decided
    before the first step.
  - The old rules (foundation, door sizes, lights every 7, nothing floats, markers, the portal frame, the limits)
    all stay.
- **Code:** `readAnswer` takes `plan` (12 lines of 200 characters at most, anything else dropped), it is kept with
  the version and shown on the card over the picture as "The parts". `DESIGN_LIMITS.steps` 300 to 600 and
  `unrolled` 5,000 to 20,000 (the planner's temple is 199 as written; a larger build needs room). The block limit
  and the 64 KB stay. `server.mjs` appends the block list as before; its test that the prompt equals
  `modpack design-prompt` still has to pass.
- **`modpack/designer/examples/temple_b.json`** is added (the tests compile every file there). It is not put in the
  prompt: one whole example would make every build a temple.
- **If the CLI has a setting for how hard the model thinks before it answers,** this call uses its highest.

### 3b. The test, before anything of Part 3 is deployed

From a terminal, as in docs/39 Step 0.4, with the new prompt: the same three asks (the temple, the arena, the
watchtower) and two new ones ("a ruined gatehouse over a road, mossy stone, half its roof gone"; "a dwarven forge
hall cut into a hillside, blackstone and copper, a great chimney"). For each: parsed first time or not, time,
tokens out and the picture beside the old one. **Alex looks at the five pictures.** If the three old asks are not
plainly better, the planner changes the instructions again before any more code is written.

### 3c. The picture shows what was built

- `render` draws by kind: a slab as a half block (bottom or top), stairs as a half block with a quarter on it
  facing the right way (upside-down ones too), walls, fences, panes, chains and lanterns as thin posts, glass
  see-through. `picture` hands it the properties it needs.
- `render` rounds `tile` down to a multiple of 4, with a test that a build of 41 by 59 at tiles 6 and 10 puts no
  block outside its own outline.
- The card's picture is larger (as wide as the card, 960 at most) and a little lighter on dark stone: the sides'
  shade 0.78 and 0.6 become 0.85 and 0.68 and a block's top edge gets a thin lighter line.

### 3d. New steps, only after 3b says the direction is right

Each replaces something the designer can already do the long way, so recipes get shorter and go wrong less often:

| op | fields | makes |
|---|---|---|
| `roof` | `from`, `to` (the walls' box at eave level), `kind` (`gable_x`, `gable_z`, `hip`, `lean_north` …), `with`, `eave?`, `ridge?`, `overhang?` (0 to 2), `gables?` | the whole roof in stair blocks, its eave rows and ridge and the gable walls filled |
| `arch` | `from`, `to` (the opening, one block thick), `with` (the stair block for its corners) | the opening cleared and its top corners rounded |
| `ring` | `centre`, `radius`, `facing` (`x` or `z`), `with`, `fill?` | an upright ring and what is inside it: round windows |
| `cone` | `base`, `radius`, `height`, `with` | a spire or a round roof |
| `column` | `base`, `height`, `shaft`, `trim` | a column with its base and head |
| `battlements` | `from`, `to`, `with` | a parapet with every second block raised |

and one new kind of material, `{"bands": [[block or mix, upToY], ...]}`, so one `walls` step makes a banded wall.
These go into `design.ts`, the instructions' step list and "How to make things" together, with tests and one
example each.

### 3e. Later, each to be proven first, none built now

- **The designer sees its own picture** and improves it once before the answer is shown. Needs the CLI to take a
  picture in its non-interactive mode with no tools; to be tried from a terminal.
- **Three sketches to pick from**: three plans drawn as plain grey shapes, Alex picks one, the designer details it.
- **Parts from uploads**: a step that stamps an uploaded build (docs/37) into a design, turned as needed, so a
  tower or a gate made by a person can be used inside a build the designer lays out.

## What to expect

Better direction took the planner's hand-written temple from a shed to something with a shape. The designer should
get a good part of the way there by itself and 3b says how far. It will still not match a build a skilled person
spent a weekend on. For a showpiece, the surest path stays docs/37 (bring a person's build in) and 3e's last item
is how the two would meet.

## Order

1. Parts 1 and 2 and 3c's tile fix: build, `dev`, then a `dev` → `main` PR and a deploy.
2. 3a's files and code on `dev`, then 3b from a terminal. Stop and show Alex the five pictures.
3. On his word: deploy 3a; build the rest of 3c; then 3d.

## Not proven

- That the new instructions lift the designer's builds as much as they lifted the planner's. 3b.
- That longer recipes still come back as clean JSON that passes the checks the first time.
- That work started with `after` outlives the response here.
- That a call under the new instructions stays under 600 s.

## Parts 1 and 2 and 3c's tile fix, as built (2026-10-07, on `dev`, in the `dev` → `main` PR)

- **Part 1.** `nameOf`, `designName` and `titleOf` in `apps/web/src/lib/designer.ts`. Letters that do not come apart
  into a letter and an accent are spelled out (ø o, æ ae, œ oe, ß ss, đ and ð d, þ th, ł l, ı i): "Ødegård's Smedje"
  is `odegard_s_smedje`. The card shows "Saved as …" from the names of designs and uploads it is given with the page;
  `designAction` works it out again from the files. The list of designs shows the title too. **Upload:** an empty
  name is the file's own name. **Capture** keeps `required`: an empty name there would be `build` and replace the
  last capture called that without a word.
- **Part 2, a promise held at module level, not `after`.** `web` is one long-lived node process: a promise nobody
  awaits runs to its end whatever happens to the request that started it, and the action now answers before the
  work begins, so the page has nothing to hold. `after` would have needed proving and adds nothing here. The process
  id (`boot`) and the running promises live on `globalThis`: Next can load a module once per route bundle, and a
  module-level id could differ between the action that wrote the job and the route that reads it, which would show a
  live job as dead (test: a fresh import of the module has the same id). `src/server/design-jobs.ts`,
  `GET /api/admin/designer/job`, `jobAction` and `clearJobAction`.
- **What differs in the details:** the refusal of a second start says the day too ("started Wed 7 Oct, 14:02"); the
  card's running line says the stage in words; the work writes the new version over the design as it is when the
  answer comes (read again then), not over the copy it started from. There is no `revalidatePath` in the background
  (no request there); the card refreshes the page itself when the job ends. The time limits (600 s, 630 s) went in
  with Part 2.
- **3c's tile fix:** `render` rounds `tile` down to a multiple of 4. The test draws a box of 41 by 59 at tiles 4, 6,
  8, 10 and 12 and checks every drawn pixel lies inside the box's outline: with the old rounding it found 27,519
  pixels outside at tile 6; none now.
- **Change log:** `2026-10-07-build-designer`.
- **Not seen yet:** the card in a browser, mid-design, with the page left and opened again, and the other cards
  working meanwhile. That needs the deploy.

## 3a, as built (2026-10-07, on `dev` after the PR, not deployed)

- `tools/designer/instructions.md` is the planner's file, word for word. Every example in "How to make things"
  compiles: 10 blocks, 29 steps, in a build of 41 by 55 by 59 with the materials they name (`wall`, `wall_low`,
  `wall_high`, `trim`).
- `modpack/designer/examples/temple_b.json` as handed over: 199 steps as written, as the plan says, but 15.2 KB on
  disk, not 17.5. It compiles to 133,000 places (its first step clears the whole box, so air is written everywhere);
  writing that as NBT takes about 2 s (`writeNbt` makes a small buffer for every number), so the test that compiles
  every example has 60 s.
- `plan`: `planOf` in `apps/web/src/lib/designer.ts` (12 lines of 200 characters, anything that is not a line of
  text dropped), kept on the version, shown as "The parts" over the picture; `modpack design` prints it.
- `DESIGN_LIMITS.steps` 600, `unrolled` 20,000.
- **The highest effort:** the CLI has `--effort` (low, medium, high, xhigh, max); every call now has `--effort max`.
- The prompt with the new instructions and the block list is 23,886 bytes (15,365 before).
- Not pushed while the PR for Parts 1 and 2 is open (its head is `dev`); pushed after it is merged.

## 3b, as run (2026-10-07)

Run in the designer's own container (the pinned image, as its user, read-only root, no capabilities: what compose
runs), one call at a time, with the new prompt (23,886 bytes: the new instructions and the block list as it was
before the interior blocks) and the message `server.mjs` sends for a new build.

**At `--effort max` nothing came back.** The temple, the arena, the watchtower and the gatehouse were each stopped at
610 s with no answer. One more temple at `max` with 40 minutes allowed was stopped at 2,400 s, still with no answer.

**At `--effort high`, all five came back, each a recipe that passed `parseRecipe` and `compile` the first time:**

| ask | build | time | tokens out | memory peak | the designer's estimate, at API prices |
|---|---|---|---|---|---|
| temple, about 40 by 40, deepslate and copper | 41 by 54 by 49, 12,500 blocks, 10 parts | 491 s | 46,227 | 137 MB | $0.93 |
| round boss arena, about 35 across, 25 by 25 clear floor | 49 by 46 by 61, 26,984 blocks, 10 parts | 585 s | 53,430 | 145 MB | $1.08 |
| watchtower about 9 by 9 and 30 high | 21 by 38 by 21, 2,590 blocks, 9 parts | 480 s | 44,686 | 134 MB | $0.90 |
| ruined gatehouse over a road | 41 by 40 by 33, 6,988 blocks, 7 parts | 496 s | 46,323 | 135 MB | $0.93 |
| dwarven forge hall in a hillside | 49 by 50 by 52, 26,511 blocks, 10 parts | 612 s | 54,827 | 145 MB | $1.10 |

(Step 0.4, the old instructions: 107 to 224 s, 9,237 to 14,871 tokens out.) The recipes kept their own sizes where
the ask could not be met and said so: the arena is 47 across because a 25 by 25 square needs a round floor 35 across
inside the stands; the watchtower stays 9 by 9 with its porch and gallery outside it.

**What proved wrong in docs/40 and in the instructions:**

1. "This call uses its highest" effort: at `max` no design finished, in 10 minutes or in 40. `server.mjs` asks for
   `high`.
2. "That a call under the new instructions stays under 600 s": two of five took 585 s and 612 s, so the forge hall
   would have failed on the site. The designer's limit should be about 900 s and web's wait 930 s, with a dead job
   at 17 minutes; not changed here, for the planner and Alex.
3. `temple_b.json` is 15.2 KB, not 17.5 KB (199 steps, as said).
4. A design now costs four to five times the tokens of docs/39's (45,000 to 55,000 out, most of it thought before
   the answer), so `DESIGNER_DAILY` at 80 is a larger share of the plan than it was.

Nothing in the instructions failed to compile or to hold: every example compiles, and all five answers kept to the
rules (foundation, the portal frame of reinforced deepslate unlit and marked, no floating parts seen in the pictures).

## Interiors and the 15-minute limit (Alex, 2026-10-07, after the 3b pictures; on `dev`, not deployed)

- **Alex's words:** "i want the builder to be able to do intiors too"; then, with the five pictures seen, "yes do the
  interiors, 15 minute limit". His choices: vanilla interior blocks and the pack's furniture mods; the instruction text
  after the pictures.
- **The block list** gains 165 interior blocks (435 in all): carpets, candles, doors, trapdoors, workstations,
  ladders, campfires, pots, and Another Furniture, Handcrafted and Macaw's Furniture in oak, spruce and dark oak
  (chairs, tables with cloths, benches, couches, sofas, fancy beds, shelves, shutters, curtains, lamps, trims,
  trophies, crockery). Every property a kind allows was checked against the blocks' states in the jars; a furniture
  block takes only what a designer chooses (facing, a cushion's or a cloth's colour, open, lit, a bed's or a door's
  half) and the game sets its legs and joins (to be seen on the server). Left out: anything that stores items
  (drawers, cabinets, wardrobes, cupboards, counters, ovens), sinks (they hold water), vanilla beds (drawn by the
  game's code, so their states are not in the jar to check), the anvil (it falls). A mirror swaps a door's or a
  shutter's hinge, as the game does.
- **Which way furniture faces, read from the three mods' models:** for every chair, bench, sofa and couch, `facing`
  is the way a person sitting in it looks (the back is on the other side); for Handcrafted's fancy bed, `facing`
  points from the foot to the head, as for a vanilla bed.
- **The instructions** gain "Rooms and furniture" between "How to make things" and "The recipe" (the planner's text
  is unchanged): upper floors 5 or 6 apart with a stair hole, rooms behind inner walls, a one-block door allowed
  between two small rooms (the 3 by 4 rule stays for the ways in and the main ways through), furniture where it would
  stand and facing into the room, about a third of a floor furnished, each room furnished for its use, lights every 7,
  which way furniture faces; four examples (a floor with its stairs, an inner wall with a door, a dining table, a
  bed). A test now compiles every example in the instructions (14 blocks).
- **Time:** the designer gives up at 900 s, web waits 930 s, a job (the first call and at most one send-back) is
  given up at 32 minutes. The card says "about 10 minutes, up to 15".
- The prompt is 34,800 bytes.
- **The furnished test** (the same container run as 3b, `high` effort, 900 s allowed): "a two-storey dwarven inn in
  deepslate and dark oak: a tavern hall with long tables, benches and a big hearth on the ground floor, and four
  bedrooms upstairs". 738 s, 70,226 tokens out, 153 MB, a recipe that passed the checks the first time: 41 by 44 by
  41, 8,958 blocks, 16 parts; the upper floor of dark oak planks at y 10 with its stair hole; 212 furniture and fitting
  blocks of 49 kinds (long tables with cloths, benches facing them, crockery, candles, a hearth with a trophy and a
  couch, a bar, a kitchen with a campfire under a hood, four bedrooms each with a bed, side table, lamp, carpet,
  table, candle and chair). The picture still draws furniture as whole cubes (3c, not built), so the rooms read by
  colour only.
