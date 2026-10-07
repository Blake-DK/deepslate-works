# 39. The build designer: describe a build, see it, keep it (plan, Alex 2026-10-07)

## Context

docs/37 made it possible to bring a build file in, check it and place it. What is still missing is the file itself:
Alex does not want to build the server's structures (the temple at spawn, boss arenas, the season zone) by hand in
the game. In his words: "I just want to plan it and tell you what to do."

Alex's ask (2026-10-07): put a designer on the Builds page, run the way his note "the assistant CLI in a container"
describes (a container that calls the host's assistant CLI as a subprocess, signed in with his own plan, no API
key), with custom instructions so that it only designs and builds.

This spec is the plan. Nothing of it is built. **Step 0 comes first and decides whether the rest is worth building.**

## The idea in one paragraph

On Admin → Seasons → Builds a new card, "Design a build". Alex types what he wants. The site sends that to a small
new container, `designer`, which runs the assistant CLI once with fixed instructions and no tools. The answer is not
a build file and not code: it is a **recipe**, a short JSON list of shapes ("a hollow box of deepslate bricks from
here to there, a dome on top, clear a doorway"). Our own code turns the recipe into a structure file and a picture.
Alex looks, asks for changes in words and presses "Keep this build" when it is right. From there it is an ordinary
upload: Build, Sync, Place or `//paste`, Lock, exactly as docs/37.

## Facts checked (2026-10-07)

- **Alex's note** (not in the repo): the pattern runs today on another of his hosts. Two read-only mounts (the CLI's
  folder with its symlink and the folder of versioned binaries it points at), one read-write mount (the login
  folder, as a whole folder, so a refreshed token is written back), `DISABLE_AUTOUPDATER=1`, the prompt on stdin, a
  neutral working folder, a replaced system prompt, one call at a time behind a lock.
- **The binary needs glibc.** `web` and `api` are `node:22-alpine`, so neither can run it. `api` also has no route
  to the internet (it lives in the tunnel's namespace). So this is a new container, not a change to either.
- **The `internal` network** in `deploy/docker-compose.yml` is an ordinary bridge: a container on it can call out,
  and nothing outside can call in unless a port is published.
- **The vendor's terms** (their "Legal and compliance" page, section "Authentication and credential use", read
  2026-10-07): a plan login is for the subscriber's own ordinary use of the CLI. Routing requests through a plan
  login on behalf of other users is not permitted; for that they name an API key. This is why "Who may use it" below
  is the owner alone while the designer runs on the plan login.
- **The vendor's billing note for non-interactive calls on a plan** announced a separate monthly credit from
  2026-06-15 and then says the change is paused and nothing has changed. So today these calls count against the same
  plan limits as Alex's own sessions (the VPS session included). To be read again before go-live.
- **The repo's naming rule** stands: the vendor and its product are not named in code, docs, tests or commit
  messages. Everything that would name them (the command, the three host folders, the model) is a variable in
  `deploy/.env`, with placeholders in `.env.example`.

## The guardrails ("only design and build")

The instructions ask for it. The construction enforces it:

1. **No tools.** The CLI runs with an empty tool list. It cannot read a file, run a command, open a page or touch
   the server. All it can do is return text.
2. **The instructions live in the designer container**, read from `modpack/designer/instructions.md` (mounted
   read-only). `web` sends only two things: what the admin typed and the current recipe. So even a broken-into `web`
   gets a build designer and nothing else out of it.
3. **The answer must be one JSON object** that passes our schema. Anything else is shown as "the designer did not
   return a build" with its text, escaped and nothing is stored.
4. **Only our code makes the file.** The recipe is compiled by `packages/modpack/src/design.ts`. Blocks come from a
   fixed list; sizes and counts are capped; the result goes through docs/37's check like any upload.
5. **The login never reaches `web`.** Only `designer` mounts it. `designer` publishes no port and is on `internal`
   only.
6. **Nothing is placed by the designer.** Keeping a build only writes a file into `data/builds/`. Placing stays a
   person's press, as today.

## Who may use it

- **On the plan login (`DESIGNER_AUTH=plan`, the default): the owner only**, meaning the account whose Discord id is
  `ADMIN_DISCORD_ID`. Other admins see the card greyed with "Only the owner can use the designer". This follows from
  the terms above.
- **On an API key (`DESIGNER_AUTH=key`, `DESIGNER_API_KEY` set):** any admin with a new per-admin tick "Designer" on
  People (same shape as `builderTools`, default off, audited `user.designer`). The key is handed to the CLI through
  its own environment variable inside `designer` only. Not built in the first pass unless Alex wants other admins
  designing.

## The recipe

A recipe is what the designer returns, what is stored and what Alex's changes are applied to.

```jsonc
{
  "name": "temple",                      // a-z 0-9 _ , 2 to 24, the build's name
  "size": { "x": 41, "y": 24, "z": 41 }, // 1 to 128 each. x east, y up, z south. 0,0,0 is the lowest north-west corner
  "ground": 3,                           // the y people walk on; everything below is foundation, sunk into the terrain
  "seed": 7,                             // for the mixes, so the same recipe always gives the same build
  "materials": {
    "wall": [["minecraft:deepslate_bricks", 7], ["minecraft:cracked_deepslate_bricks", 2], ["minecraft:mossy_cobblestone", 1]],
    "floor": "minecraft:polished_deepslate",
    "light": "minecraft:lantern[hanging=true]"
  },
  "steps": [
    { "op": "box", "from": [0, 0, 0], "to": [40, 2, 40], "with": "wall" },
    { "op": "box", "from": [4, 3, 4], "to": [36, 14, 36], "with": "wall", "hollow": true },
    { "op": "clear", "from": [19, 3, 4], "to": [21, 7, 4] }
  ],
  "markers": [{ "name": "portal", "at": [20, 3, 34], "note": "frame 4 wide, 5 high, facing north" }]
}
```

**Steps**, applied in order, a later one writing over an earlier one:

| op | fields | makes |
|---|---|---|
| `box` | `from`, `to`, `with`, `hollow?` | a solid box, or with `hollow` its six faces only |
| `walls` | `from`, `to`, `with` | the four sides of a box, no floor or roof |
| `cylinder` | `base`, `radius`, `height`, `with`, `hollow?` | an upright cylinder, `base` its bottom centre |
| `dome` | `base`, `radius`, `with`, `hollow?` | the upper half of a sphere |
| `pyramid` | `from`, `to`, `with`, `hollow?` | a roof that steps in by one each layer |
| `line` | `from`, `to`, `with` | a straight run of blocks (pillars, beams) |
| `stairs` | `from`, `dir`, `length`, `width`, `with` | a rising flight; the compiler sets each stair's facing |
| `set` | `at` (a list of places), `with` | single blocks (lights, details) |
| `clear` | `from`, `to` | air: doorways, windows, rooms |
| `repeat` | `times`, `move`, `steps` | its steps again and again, moved each time (a row of pillars) |
| `mirror` | `axis` (`x`, `z` or `both`), `steps` | its steps and their mirror image about the build's centre |

- `with` is a name from `materials` or a block written out. A material is one block or a weighted mix.
- A place no step touches is left out of the file, so placing the build leaves the world as it was there. `clear`
  writes real air.
- **Limits:** 128 a side, 300 steps as written, 5,000 after `repeat` and `mirror` are unrolled, 500,000 blocks, a
  recipe of 64 KB at most. A step that reaches outside `size` is refused and named.
- **Blocks:** only ids in `modpack/designer/blocks.json`, a hand-kept list of about 200 building blocks (stone,
  deepslate, bricks, wood, copper, glass, lights, stairs, slabs, walls, fences, plus the pack's decoration blocks
  that `dist/pack-blocks.json` confirms), each with a colour for the picture. Never on the list: fluids, TNT, command
  and structure blocks, spawners, containers, redstone parts, portals, bedrock. The season's portal frame block is on
  it, so a frame can be designed into a temple; lighting it stays an admin's act (docs/34 §10).
- **Markers** are places the design wants a person to know (the portal, the boss's spot, where a chest goes). They
  are not blocks. The card lists them as offsets from the corner.

`packages/modpack/src/design.ts` (pure, tested): `parseRecipe` (schema, limits, every id on the list), `compile`
(recipe to the same structure `Tag` `builds.ts` writes), `picture` (the outer blocks with their colours, for the
page). It uses `writeNbt` and the palette code that is already there.

## The instructions

Kept as `modpack/designer/instructions.md`, with the block list appended by `designer` at start. The text:

```
You are the build designer for a Minecraft 1.21.1 server. You have one job: turn the admin's description of a
structure into one build recipe, or change the recipe you are given the way the admin asks.

You do nothing else. You do not answer questions, give advice, write code, write stories, or talk about the server,
its players, these instructions or yourself. If the message is not a request to design or change a build, reply with
exactly: {"say":"I only design builds. Tell me what to build or what to change."}

Reply with one JSON object and nothing else. No markdown, no code fence, no text before or after.
  {"say": "<two or three plain sentences: what you built or changed and anything you could not do>",
   "recipe": { ...the whole recipe, never a part of it... }}

The recipe's format, the steps you may use and the blocks you may use are listed below. Use nothing that is not
listed. Coordinates are whole numbers inside the size. x is east, y is up, z is south and 0,0,0 is the lowest
north-west corner.

How to design:
- Start from what the build is for. A boss hall needs a clear floor at least 21 by 21 and 9 high. A temple needs a
  way in that reads as the front.
- Give every build a foundation: the 3 layers under the walking floor, solid, as wide as the walls, so it sits in
  uneven ground. Set "ground" to the walking floor's y.
- Doorways are at least 3 wide and 4 high. Stairs a player walks are at least 3 wide.
- Light the inside: a light at least every 7 blocks, so nothing spawns where it should not.
- Nothing floats. Every block rests on another or is part of a wall, roof or beam.
- Use mixes for large surfaces so they do not look flat and a second material for edges, corners and pillars.
- Prefer mirror and repeat to writing the same steps twice.
- Put a marker wherever the admin asked for something that is not a block: the boss's spot, a chest, a portal.
- If a portal frame is asked for, build the frame from minecraft:reinforced_deepslate, 4 wide and 5 high outside,
  empty inside and mark it. Do not try to light it.
- Stay inside the limits. If the admin asks for more than the limits allow, build the largest version that fits
  and say so in "say".

When you are given a current recipe and a change, keep everything the admin did not ask to change, keep its name
and seed and return the whole recipe.
```

## The `designer` container

- **Image:** stock `node:22-bookworm-slim`, pinned by digest. No image of our own, so CI builds nothing new and the
  VPS still builds nothing. The program is one file with no dependencies, `tools/designer/server.mjs`, mounted
  read-only from the checkout with `modpack/designer/`.
- **Compose** (every host path a variable; `deploy.sh` leaves the service out while `DESIGNER_CMD` is empty):

```yaml
  designer:
    image: node:22-bookworm-slim@sha256:<digest>
    container_name: deepslate-designer
    restart: unless-stopped
    logging: *logging
    mem_limit: 768m                      # to be measured in Step 0
    networks: [internal]                 # never on `web`; no ports
    working_dir: /tmp
    command: ["node", "/designer/server.mjs"]
    environment:
      HOME: ${DESIGNER_HOME}
      PATH: ${DESIGNER_BIN_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
      DISABLE_AUTOUPDATER: "1"
      DESIGNER_CMD: ${DESIGNER_CMD}
      DESIGNER_MODEL: ${DESIGNER_MODEL}
      DESIGNER_TOKEN: ${DESIGNER_TOKEN}
    volumes:
      - ${DEEPSLATE_DIR:-..}/tools/designer:/designer:ro
      - ${DEEPSLATE_DIR:-..}/modpack/designer:/designer/data:ro
      - ${DESIGNER_BIN_DIR}:${DESIGNER_BIN_DIR}:ro            # the command's symlink
      - ${DESIGNER_VERSIONS_DIR}:${DESIGNER_VERSIONS_DIR}:ro  # the binaries it points at
      - ${DESIGNER_LOGIN_DIR}:${DESIGNER_LOGIN_DIR}           # the login, read-write, the whole folder
    security_opt:
      - no-new-privileges:true
```

- **The host user.** A user of its own on the VPS (not root, not ladm), with the CLI installed and signed in once
  by Alex and an empty settings file: no plugins, no default model. Alex's note measured about 10k tokens a call
  for a root login that carries plugins. The three folders above are that user's. The container runs as that
  user's uid so a refreshed token is written back with the right owner.
- **`server.mjs`:**
  - `POST /design` with `{ ask, recipe? }` and the header `x-designer-token`. `ask` 2,000 characters at most.
    Runs `$DESIGNER_CMD -p --output-format json --model $DESIGNER_MODEL --system-prompt <instructions> --allowedTools ""`
    with `cwd=/tmp`, the prompt on stdin only, a 300 s timeout, killed on timeout. Returns
    `{ text, ms, usage }` from the CLI's JSON (`result`, the token counts), or `{ error }`.
  - **One call at a time.** A second caller gets 409 "busy" at once; the page says "The designer is busy".
  - `GET /health`: `{ cli: "<version>" | null, signedIn: <the credentials file is there>, busy }`. It makes no call.
  - No other route. The command, the flags and the instructions are fixed in the file; nothing from the request
    becomes an argument.
- **Updating the CLI** is the host's job (Alex's note): an update on the host is seen on the next call because the
  folders are mounted, not the single file. No restart.

## The site

- **`web`** gets two variables, `DESIGNER_URL` (`http://deepslate-designer:4100`) and `DESIGNER_TOKEN`, in
  `docker-compose.yml`, `env.ts` and `.env.example`. Without `DESIGNER_URL` the card says "Not set up" and nothing
  else changes.
- **Admin → Seasons → Builds, card "Design a build"** (owner only, see above):
  - A box: "What should it be?" and a name. **Design** sends it. While it runs: "Designing… this takes a minute or
    two" and the button is off.
  - The answer: the designer's `say`, the size and block count, the materials, the markers and **the picture**: an
    angled view drawn in the browser from `picture`, four turns, a slider that cuts the build floor by floor so the
    inside can be seen.
  - Under it: "What should change?" and **Change it**. Each change sends the current recipe with the new words.
    Every version is kept; "Back to version 3" makes it the current one.
  - **Keep this build** compiles the current version and stores it through `storeBuild` as `<name>.nbt`, so docs/37's
    check, the out-of-date box, Build, Sync, Place and the WorldEdit copy all work with no change. A design that was
    kept shows "designed" beside its name in the uploads list, with a link back to its versions.
  - A design that does not pass (`parseRecipe` or `compile` refuses it) is sent back to the designer once by itself
    with the refusal's text ("step 14 reaches outside the size"). A second failure is shown as it is.
- **Stored** as `data/builds/designs/<name>.json`: the versions (recipe, `say`, the ask, when, token counts) and
  which is current. Not in git, like the uploads. Removing an upload does not remove its design.
- **Limits:** 30 calls an hour and `DESIGNER_DAILY` a day (default 80), counted in the database. The plan's own
  limits are shared with Alex's sessions; the daily number keeps a long evening of designing from eating them.
- **Audit:** `build.design` (who, the name, the ask, ms, tokens, passed or not) and `build.design.keep` in the event
  log.
- **Health:** `/api/health` gains `designer: { ok, signedIn, cli }`; Admin → Overview shows a row only when it is set
  up and not ok ("The designer is signed out": sign in on the host, no restart needed).

## `.env.example` (placeholders)

```
# docs/39: the build designer. Leave DESIGNER_CMD empty to switch it off.
DESIGNER_CMD=
DESIGNER_MODEL=replace-me-model-name
DESIGNER_TOKEN=replace-me-long-random
DESIGNER_URL=http://deepslate-designer:4100
DESIGNER_HOME=/home/replace-me
DESIGNER_BIN_DIR=/home/replace-me/.local/bin
DESIGNER_VERSIONS_DIR=/home/replace-me/.local/share/replace-me
DESIGNER_LOGIN_DIR=/home/replace-me/.replace-me
DESIGNER_AUTH=plan
DESIGNER_DAILY=80
```

## Step 0: prove it before any page (no deploy, no container)

1. `packages/modpack/src/design.ts` with its tests, `modpack/designer/blocks.json` and `instructions.md`, on `dev`.
2. A CLI command, `pnpm modpack design <recipe.json>`, that writes `<name>.nbt` and a picture as a PNG.
3. Two recipes written by hand (a 21 by 21 boss hall, a small gate) to prove the compiler and their PNGs.
4. On the VPS, from a terminal, as the designer's host user: the command above with the instructions and three asks
   of Alex's ("a temple for the boss portal at spawn, about 40 by 40, deepslate and copper"; a boss arena; a
   watchtower). Three recipes, three PNGs, the time and tokens each took and how much memory the process used.
5. One of them uploaded on the live Builds page and placed in the sample Frontier. This is also the first proof
   that the game takes a structure file written by our code (open since docs/34 §10).

**Alex looks at the three pictures.** If they are good enough to be worth changing in words, Steps 1 to 3 follow.
If they are not, the compiler and the CLI command stay (the planner can still write recipes by hand) and the page
is not built.

## Steps 1 to 3

1. **The container:** `tools/designer/server.mjs` with its tests (the command run is a stub in tests), the compose
   service, the variables, `/api/health`. Deployed switched off; Alex makes the host user and signs in; then on.
2. **The card:** design, picture, change, versions, keep. The limits and the audit.
3. **After a week of use:** whether the block list needs more of the pack's decoration blocks and whether the API
   key mode and the "Designer" tick are wanted for other admins.

## Not proven

- That a recipe language this small gives builds worth keeping. Step 0 is for this.
- That the CLI answers with clean JSON every time under these instructions; the page allows for it not doing so.
- The CLI's memory use beside the VPS's other services (7.7 GB shared; see the incident of 2026-09-29).
- That the game takes our structure files and block states written as the designer writes them (a wrong property
  on a stair or a lantern).
- That the CLI keeps no session files worth worrying about in the login folder for calls like these; if it has a
  switch for keeping none, `server.mjs` uses it.

## Not in scope

- Placing, locking or capturing from the designer. A person presses those.
- Terrain: the designer does not see the world. The foundation rule is its only answer to uneven ground.
- Players. Admin only and the owner only on the plan login.
- Entities, chests with contents, redstone, command blocks.

## Step 0, as built (2026-10-07, on `dev`): items 1 to 3

- **Numbered 39.** The plan was written as docs/38; docs/38 is the security register, so it is filed here.
- **`modpack/designer/blocks.json`: 270 blocks**, more than the plan's "about 200": vanilla stone, deepslate,
  blackstone, bricks, sandstone, quartz, prismarine, purpur, four woods, waxed copper (so it keeps its colour), glass
  and panes, bars, chains, lights, terracotta, concrete, ground blocks and leaves, plus from the pack Create's cut
  deepslate, waxed copper shingles and tiles and framed glass, and Create Deco's dusk, dean, pearl and umber bricks.
  Each block has a kind (`stairs`, `slab`, `axis`, `wall`, `fence`, `pane`, `lantern`, `wall_torch`, `leaves`, or none
  for a full block) that says which properties it takes. **Every property and value a kind allows was checked
  against the block's states** in the game's client jar (`dist/cache/client-1.21.1.jar`) and in the server's
  Create 6.0.10 and Create Deco 2.1.3 jars; the colour is the average of the block's own texture. Left out beyond
  the plan's list: blocks that fall (sand, gravel, concrete powder), obsidian (a nether portal frame), doors, beds
  and trapdoors (two blocks, or open and shut), and the valuable blocks (gold, iron, diamond, emerald: a build
  players could mine for loot). Leaves are always written persistent, so they never decay. Walls, fences and panes
  are written without their connections: the game sets those when it places a structure, to be seen on the server.
- **`modpack/designer/instructions.md`:** the plan's text as it stands, then "The recipe", "The steps" and "Limits"
  in the same plain words. `designer` (Step 1) appends the block list, grouped by kind with the properties each
  takes (`blockListText`).
- **`packages/modpack/src/design.ts`:** `parseRecipe` (a string or parsed JSON; the shape with unknown fields
  refused, so a typo such as `"hollw"` is sent back and not ignored; every block and property on the list; every
  material named; every step and every copy a `repeat` makes inside the size; the limits), `compileGrid` / `compile`
  / `gridToStructure` (the grid and the same structure `Tag` `builds.ts` writes, DataVersion 3955), `picture` (the
  blocks with a side open to the air and their colours, `cut` leaves out the layers above), `render` / `renderTurns`
  (the angled view as pixels, four turns), `blockCounts`. Refusals name the step: "step 2.1 reaches outside the size
  (moved by 0, 8, 0): y goes to 8, the size is 8 (0 to 7)".
- **What the plan left open, as decided here:** `hollow` on a cylinder is its round wall only (a tower's shell); on
  a pyramid each layer's edge with the top layer whole, so the roof is closed. `stairs` is `width` wide towards the
  east (dir north or south) or the south (dir east or west); a full block in a flight stays a full block. `mirror`
  turns stairs and torches to match (`facing` east and west swap about x, north and south about z). A mix picks per
  place from the seed and the place, so a mirrored or moved part has its own mix and the same recipe always gives
  the same build. One more limit: 20 million block writes in all, one over another counted, so a recipe of many big
  boxes cannot run for minutes.
- **The command:** `pnpm modpack design <recipe.json> [out dir]` writes `<name>.nbt`, `<name>.png` (four turns) and
  `<name>-inside.png` (cut two layers above the walking floor) into `dist/designs/`, and prints the size, each block's
  count and the markers. It takes a recipe on its own, the designer's answer (`{"say", "recipe"}`) or the CLI's whole
  `--output-format json` output (the answer in `result`), so Step 0.4's output goes straight in.
  `pnpm modpack design-prompt` prints the whole system prompt, instructions and block list: 15 KB.
- **The two recipes:** `modpack/designer/examples/boss_hall.json` (25 by 18 by 25, 3,897 blocks: a 21 by 21 floor,
  10 high inside, a stepped roof, a doorway 3 wide and 4 high on the north side, 16 lights in the floor, barred
  windows on all four sides, the boss's spot marked) and `gate.json` (11 by 13 by 5, 578 blocks: two towers, a way
  through 5 wide and 4 high, a copper lintel, two hanging lanterns, battlements). Each compiles in under 40 ms.
- **Tests:** `packages/modpack/tests/design.test.ts` (the list against the game's items and the refused kinds,
  every refusal, every step's shape, mixes, mirror and repeat, the two examples through docs/37's upload check, the
  picture). `deploy/check.sh modpack` green, 191 tests.
- **Checked on the VPS's own CLI (`--help`, 2026-10-07), for Step 0.4 and for `server.mjs`:** `--allowedTools ""`
  does not take tools away; it only lists tools allowed without asking. **`--tools ""` is the empty tool list.**
  `--no-session-persistence` (with `-p`) keeps no session on disk, which answers the last line of "Not proven";
  `--strict-mcp-config` with no `--mcp-config` loads no MCP servers. `--bare` cannot be used on the plan login: it
  reads only an API key.

### Step 0.4, how to run it

The prompt and the pictures are made as `ladm` from the checkout (they need Docker, which the designer's user does not
get); only the call itself runs as the designer's user, once it exists and is signed in (no plugins, no default
model).

As `ladm`, the prompt into a file the other user can read:

```
docker run --rm --memory=512m -v "$PWD":/app:ro -w /app/packages/modpack -e MODPACK_DIR=/app/modpack node:22-alpine node_modules/.bin/tsx src/cli.ts design-prompt > /tmp/designer-prompt.txt
```

As the designer's user, one ask (the command and the model are the values meant for `DESIGNER_CMD` and
`DESIGNER_MODEL`):

```
echo "a temple for the boss portal at spawn, about 40 by 40, deepslate and copper" | /usr/bin/time -v "$DESIGNER_CMD" -p --output-format json --model "$DESIGNER_MODEL" --system-prompt "$(cat /tmp/designer-prompt.txt)" --tools "" --no-session-persistence --strict-mcp-config > /tmp/temple.json
```

`time -v` prints "Maximum resident set size" (the memory); the JSON has the time and the token counts. Then as
`ladm`, the recipe into `/tmp/designs/temple.nbt` and its pictures:

```
docker run --rm --memory=1g -u "$(id -u):$(id -g)" -v "$PWD":/app:ro -v /tmp:/tmp -w /app/packages/modpack -e MODPACK_DIR=/app/modpack node:22-alpine node_modules/.bin/tsx src/cli.ts design /tmp/temple.json /tmp/designs
```

## Step 0.4, as run (2026-10-07)

A host user of its own, `designer`, made by Alex, with the CLI installed, signed in on the plan and `{}` as its
settings. The prompt from `modpack design-prompt` (15,365 bytes), one call per ask, `--tools ""`,
`--no-session-persistence`, `--strict-mcp-config`, the strongest model on the plan, from a terminal.

| ask | build | time | tokens in (written to cache / read from it) | tokens out | memory (max RSS) |
|---|---|---|---|---|---|
| a temple for the boss portal at spawn, about 40 by 40, deepslate and copper | 41 by 32 by 41, 9,379 blocks | 1:47 | 6,937 / 0 | 9,237 | 264 MB |
| a round boss arena, about 35 across, a 25 by 25 clear floor, stands, the boss's spot marked | 37 by 14 by 37, 6,368 blocks | 1:54 | 568 / 6,403 | 9,401 | 258 MB |
| a watchtower about 9 by 9 and 30 high, stone bricks and dark oak, stairs inside, a lookout | 13 by 35 by 13, 1,678 blocks | 3:46 | 555 / 6,403 | 14,871 | 299 MB |

- **All three answers were clean JSON** (one object, no fence, no text around it) and **all three recipes passed
  `parseRecipe` and `compile` the first time**: no refusal to send back. They are kept as
  `modpack/designer/examples/temple.json`, `boss_arena.json` and `watchtower.json` (5.5 to 8.5 KB each, far under the
  64 KB limit), and the tests compile every file in that folder.
- **It kept to its instructions where the ask could not be met** and said so in `say`: the arena's clear floor is a
  circle 27 across ("a full 25 by 25 square with corners would need the arena to be about 47 across"); the tower is
  11 by 11, "because a 9 by 9 tower has no room for 3 wide stairs with proper turns". The temple has the portal frame
  of reinforced deepslate on a dais, unlit and marked, as instructed.
- **It used the pack's blocks unasked:** Create's cut deepslate, deepslate pillar and waxed copper shingles in the
  temple.
- **The prompt is cached between calls:** the first call wrote about 7,000 tokens to the cache, the next two read
  them back. Most of the tokens out are the model working before it answers; the recipes themselves are 2,000 to
  3,000 tokens.
- **For Steps 1 and 2:** a call takes 2 to 4 minutes, not "a minute or two": the page says "this takes a few
  minutes", and `server.mjs`'s 300 s timeout is too close to the slowest call (226 s): 420 s. The CLI's memory was
  under 300 MB in all three, so `mem_limit: 768m` holds with room for `server.mjs`.
- **For Step 1:** the CLI keeps a settings file of its own directly in the user's home, beside the login folder and
  not in it. The compose service has to mount that file too (a variable of its own, `DESIGNER_LOGIN_FILE`), or each
  call starts as a first run.

## Steps 1 and 2, as built (2026-10-07, on `dev`, not deployed)

Alex's word, the same day: build Steps 1 and 2 while the temple is tried in the Frontier (Step 0.5).

**Where it differs from the plan, and why:**

- **The instructions moved to `tools/designer/instructions.md`.** `web` mounts `modpack/` read-write (Admin → Lock
  commits there), so a broken-into `web` could have rewritten instructions kept in `modpack/designer/`, and with them
  what the designer is. `web` cannot reach `tools/`. The block list stays in `modpack/designer/blocks.json` (Build and
  the page read it), so `server.mjs` takes from it only plain block ids, the kinds it knows and plain property values:
  anything else in that file never reaches the prompt (tested).
- **The designer's whole home folder is mounted read-write, the CLI's program folders read-only over it.** The CLI
  keeps a settings file directly in the home, beside its login folder, and writes it back on a call (seen in the
  container test below); a single-file mount breaks when a file is replaced, so the plan's "login folder" mount became
  the home. The two program folders are mounted again read-only on top, so the CLI cannot change itself.
  Variables: `DESIGNER_HOME`, `DESIGNER_BIN_DIR`, `DESIGNER_VERSIONS_DIR`, `DESIGNER_UID`, `DESIGNER_GID`,
  `DESIGNER_CREDENTIALS` (the login's file, for `/health`'s "signed in"); `DESIGNER_LOGIN_DIR` and `DESIGNER_AUTH` are
  not used (only the plan's login is built).
- **The call:** `--tools ""` (not `--allowedTools ""`), `--no-session-persistence`, `--strict-mcp-config` and
  `--disable-slash-commands` (so an ask that starts with `/` is words, not a command). The CLI gets only `HOME`,
  `PATH`, `DISABLE_AUTOUPDATER` and `LANG` of the environment, never the token. Timeout 420 s (the slowest call in
  Step 0.4 took 226 s); `web` waits 450 s.
- **The container runs with a read-only root, `/tmp` in memory, no Linux capabilities**, as the designer's user.
  `deploy.sh` passes the compose profile `designer` only while `DESIGNER_CMD` is set, removes the container when it
  is emptied, and restarts it when `tools/designer/server.mjs` is newer than the container (the folder is mounted, so
  it sees the new file but keeps running the old one).
- **The limits count the `build.design` events** in the event log (one per call, a call sent back to be fixed
  included), not a table of their own.
- **The picture is drawn in the browser** with the same code the Step 0 command uses: `design.ts` was split so it
  imports nothing of node's (the structure file is written by `design-nbt.ts`), and `render` gives a
  `Uint8ClampedArray`.

**As built:**

- `tools/designer/server.mjs` (one file, no dependencies) and `server.d.mts` (its types, for the tests);
  `packages/modpack/tests/designer-server.test.ts`: the prompt is the same text as `modpack design-prompt`, the
  block list cannot carry other text, the flags, the request checks, a stand-in CLI's JSON read back (time, tokens,
  an error answer, output that is not JSON, a failed or slow command), the token on both routes, one call at a time
  (409), health without a call.
- `deploy/docker-compose.yml`: the `designer` service (stock `node:22-bookworm-slim` by digest, `internal` only, no
  port, 768 MB); `web` gets `DESIGNER_URL`, `DESIGNER_TOKEN`, `DESIGNER_DAILY`. `deploy/deploy.sh`, `.env.example`.
- `apps/web/src/server/designer.ts` (the calls, health, the files under `data/builds/designs/`, the owner check, the
  counts), `src/lib/designer.ts` (the answer read and checked, versions, the limits),
  `app/(app)/admin/seasons/design-actions.ts` (design or change, sent back once when refused; open; back to a
  version; keep), `design-card.tsx` and `design-picture.tsx` (four turns, the floor slider, the block counts).
  Uploads kept from a design show "designed", a link back to its versions. `/api/health` gains `designer`
  (admins and the host only); Admin → Overview shows a line when it is set up and not well. Events
  `build.design` and `build.design.keep`. `apps/web/tests/designer.test.ts`.
- **Checked:** `deploy/check.sh` green for modpack (203 tests) and web (543); `next build` in a capped container.
  **The container itself, run by hand as compose will run it** (the pinned image, uid 1010, read-only root, the three
  mounts, no capabilities): `/health` answered `{"cli": …, "signedIn": true, "busy": false}` and 401 without the
  token; one real ask ("a small shrine, 7 by 7 …") came back in 22 s, 2,045 tokens out, as a recipe that compiles
  (290 blocks), while a second caller got 409; the container used 130 MB. The call left no session file in the
  designer's home. It does refresh the account's synced skills and plugins there on each call; with no tools and slash
  commands off they cannot do anything.
- **Not done:** the API key mode and the per-admin "Designer" tick (Step 3, if wanted). The card has not been seen in
  a browser: it needs the `dev` → `main` PR and a deploy.
