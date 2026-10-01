-- Installer 2.1.0 (2026-10-01, kanefinch's TaCZ kick): every report says whether the pack's mods were all in the
-- game's mods folder with the right checksum before the game was started, and the app's "game_check" report says
-- which of them the game itself loaded. {ok, checked, missing: [{slug, name, filename}], where}. Null on older installers.

-- AlterTable
ALTER TABLE "InstallReport" ADD COLUMN "mods" JSONB;
