# 56 · The quarry, second pass: real power for full speed and a stop when full

Planner, 2026-10-12. Alex, after docs/53 Part A was built: "the generator is still too powerful". Part A raised the
quarry's energy costs to 4× the mod's defaults (`breakBlockBase` 100, `moveHeadBase` 4, `makeFrame` 60). A Pitiful
Generator (Industrial Foregoing, 30 FE a tick by its default) still mines about 4 stone blocks a second at that cost,
which is not slow. Alex's answers the same day:

| Question | Answer |
|---|---|
| How fast with one Pitiful Generator | **about 30 stone blocks a minute** |
| What to turn down | **the quarry costs more**; the generator and every other machine stay as they are |
| When the quarry's storage is full | **it just stops working** and starts again when there is room |

This replaces Part A's numbers in docs/53. Part A's file, `modpack/server/config/quarryplus.toml`, stays the place;
only its values change. It ships with docs/53 A, B and E1 and docs/55, in the same rehearsal and the same live PR.

## 1. The target in numbers

30 stone blocks a minute from 30 FE a tick is 36,000 FE a minute, so about **1,200 FE per stone block, everything
counted** (breaking, moving the head, the frame spread over the dig). The mod charges a block's break by its
hardness (stone 1.5, deepslate 3), so deepslate comes out at about half the speed, about 15 a minute. That is fine
and is said in the guide.

On paper that is k ≈ 32 against the mod's defaults (`breakBlockBase` 800, `moveHeadBase` 32, `makeFrame` 480). **On
paper only.** The mod's real energy sums (enchantments, the head's travel, the frame) decide, so the number is set by
measuring, below.

## 2. Measure, then set

All on the test server, with docs/53's pack loaded. One plain quarry (no enchantments), a marked area of plain
stone, one Pitiful Generator, a large chest beside it.

1. **Read the Pitiful Generator's output** from Industrial Foregoing's config on test (the key and its value). If it
   is not 30 FE a tick, the sums in §1 are redone with the real figure. The report says so.
2. **Measure at today's k = 4:** stone blocks mined in 5 minutes, per minute.
3. **Set k** so that the same quarry, same generator, same stone gives 30 a minute: k = 4 × (measured per minute ÷
   30), rounded to a whole number, applied to all three keys alike (`breakBlockBase` 25 × k, `moveHeadBase` 1 × k,
   `makeFrame` 15 × k).
4. **Measure again** at the new k: plain stone, then plain deepslate. Accept 25 to 35 a minute on stone. Outside that,
   adjust k once more and measure again.
5. **Enchantments**, at the new k, same generator: the quarry with Unbreaking III, then with Efficiency V. Blocks a
   minute for each. If Unbreaking III alone brings one Pitiful Generator back above 60 a minute, report it and stop:
   the planner decides whether the enchantment's saving is cut too.
6. **Full speed:** with unlimited power (a creative energy source, admin only on test), the quarry's top speed
   plain and with Efficiency V, with the FE a tick it draws at that speed. This is what "real power" means for
   players.
7. **What reaches full speed in practice:** the FE a tick of a few setups players will build, from their own
   numbers on test: one Mekanism Heat Generator on lava, one Gas-Burning Generator, one Wind Generator high up,
   Create's water wheels through a Crafts & Additions alternator (one wheel, four wheels). A table: setup, FE a
   tick, blocks a minute it gives the quarry.

**The report:** steps 1 to 7 as tables, the chosen k and the file as shipped. Nothing on live.

## 3. The quarry stops when its storage is full

Applies to every quarry, on the main world and on the Moon. Its own small feature PR to `dev`, shipped with the rest.

**Wanted:** a quarry whose output can go nowhere stops mining. Nothing is dropped on the ground, nothing piles up in
an endless internal buffer, no block is broken and lost. When space appears (a chest emptied, a pipe freed) it starts
again by itself. It uses no power while stopped.

1. **Read first, on the test server.** What the quarry (`additional-enchanted-miner`, mod id `quarryplus`, the jar in
   the lock) does today when its output is full or missing: drops on the ground, keeps an internal buffer (how big,
   whether it is lost when the quarry is broken), or already stops. Read the jar's config keys and the
   `config/quarryplus.toml` the mod wrote for anything about output, storage or buffers. The test: a quarry with one
   small chest, run until the chest is full, then 5 minutes more. Report what was seen.
2. **If a config key gives the wanted behaviour,** set it in `modpack/server/config/quarryplus.toml` beside the power
   keys, Sync and repeat the test: the chest full, the quarry stopped, no items on the ground, the buffer not growing,
   power use flat. Then empty the chest and see it start again.
3. **If no key does,** stop and report the options with their cost. No mod and no datapack workaround without the
   planner's and Alex's word.

## 4. What players read

The quarry's `howTo` in `mods.json`, replacing Part A's sentence: "A quarry needs real power to dig fast: one small
generator only crawls. It stops when its storage is full and starts again when there is room." No season or boss
names.

## 5. Checks, each one seen in its real state

1. The measured tables of §2, the chosen k and the file as shipped.
2. One Pitiful Generator, plain quarry, plain stone: 25 to 35 blocks a minute.
3. §3's test passes as written (or §3 step 3's report).
4. Live gets it only with the rest of docs/53 and docs/55, after a backup and on Alex's yes. A quarry digging on live
   after the restart is part of that PR's live check.
