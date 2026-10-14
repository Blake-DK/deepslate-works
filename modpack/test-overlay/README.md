# modpack/test-overlay

docs/42 T6. Files here are copied over `dist/server/` at the end of a Build on the **test server only**
(`TEST_MODE=1` in `deepslate-api-test`). The live server's build never reads this folder. Each file replaces the
file of the same path that the build made from `modpack/config/` and `modpack/server/`.

- `config/bluemap/core.conf`, `config/bluemap/webserver.conf`: BlueMap does nothing on the test world (no download
  accepted, no web server); its tunnel port belongs to the live instance.
- `config/voicechat/voicechat-server.properties`: Simple Voice Chat on UDP 24464, which nothing forwards.
- `config/ArPhEx Configurations.toml`: ArPhEx, on trial for Ashmoon only (Season 1's switch, so the test server only):
  the file the mod wrote, with `"Vanilla Replacement Mode" = 0.0` (it turned 1 in 10 ordinary mobs anywhere into ArPhEx
  mobs) `"Enable Tormentor Sky Hallucination" = false` (a scare in the main world's sky at full moon) and `"Welcome message" =
  false` (a wall of text in chat at every join; Alex, 2026-10-14). Its two spawn-rate settings at 2.0 (5 by default; lower = more):
  more of its mobs on Ashmoon (Alex, 2026-10-14).
- `config/mutantmonsters-common.toml`: Mutant Monsters, on the same trial: each mutant at 25 % of the creeper's spawn
  weight (5 % by default), so about one Ashmoon monster in five is a mutant (Alex, 2026-10-14: more mobs on the moon).

This README is not copied (Markdown files are left out).
