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
