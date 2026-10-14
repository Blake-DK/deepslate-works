# 59 · Flowers: Serene Shrubbery and Wilder Flowers

Alex wants two flower mods added straight into the pack, no vote. Test server first, live only after he has seen them on test and said go.

## The mods

| slug | name | side | category | topic | load |
|---|---|---|---|---|---|
| serene-shrubbery | Serene Shrubbery | both | building | building | L |
| wilder-flowers | Wilder Flowers | both | building | building | L |

Both must resolve on Modrinth for NeoForge 1.21.1. If either has no NeoForge 1.21.1 release (beta fallback counts as a warning to report, not a pass), stop and report back instead of adding it.

## mods.json entries

For each mod: enabled true, recommended true, hidden false, exclusiveGroup null, guide "game", topic "building", version pinned to the Modrinth version id that lock picks (same as waystones). requires is filled by lock; report any dependency it pulls in by name.

Descriptions (player-facing, keep them):
- Serene Shrubbery: "Garden flowers in lots of colours. Put two or three next to each other and new colours appear over time. Also adds the Bloom Basket planter."
- Wilder Flowers: "Wildflowers, clover patches and flower garlands you can wear or hang up. The wildflowers grow in newly explored land."

howTo (markdown, same style as the other entries):
- Serene Shrubbery: "Pick flowers you find in the wild. Plant two or three of the **same kind** side by side and wait: a new colour can sprout next to them. Craft a **Bloom Basket** from 3 planks, 1 dirt and 3 sticks to plant Pansies in."
- Wilder Flowers: "Wildflowers and clover only grow in **new land**, so look further out than you have been. Craft **garlands** from flowers to wear on your head or hang as decoration."

Wiki: each mod's Modrinth page. Videos: at least one real showcase per mod that passes verify-links; if none exists for one of them, report that and leave videos empty rather than adding an unrelated video.

Bump the pack version as usual for a client-affecting change.

## Checks before test

1. pnpm modpack lint passes.
2. pnpm modpack lock adds exactly these two mods plus any required deps; paste the lock diff in the report.
3. pnpm modpack verify-links passes.
4. Run the build inside the api container only (docs/09 memory limits). Never build images on the VPS.

## Test server

Ship to the test server through the normal flow (dev build, test profile in the launcher, installer applies the pack; no jars moved by hand). Then check and report:
- Test server starts with both mods loaded, no errors or mixin warnings mentioning either mod in the log.
- A client on the test profile joins without a mod mismatch.
- Serene Shrubbery: a flower of each kind exists in JEI; two Pansies side by side produce a new colour after waiting (use a random tick speed bump on test only to speed it up, then put it back).
- Wilder Flowers: a garland can be worn and placed; teleport to an ungenerated area well outside the explored world and confirm wildflowers and clover appear.
- Spark: TPS and MSPT unchanged on test compared with before.
- Mods guide page: both show under Building and decoration with their howTo.

## Live

Do nothing on live in this PR's first pass. Stop after the test report and wait for Alex's go. When he says go: PR dev to main, normal deploy, live sync at a quiet time, then the automated @Minecraft update post on Discord (docs/53 Part D) announcing the two mods with one line each.

## Known limits, tell players

Wildflowers and clover only appear in chunks generated after this goes live, never in land that already exists. Serene Shrubbery flowers can be bred from anything picked, so nobody needs to travel to get them.

Public repo rules apply: no real domains, IPs, emails or player names anywhere in this doc, the code or the commits.

Update docs/11-status.md at the end and send me the report.
