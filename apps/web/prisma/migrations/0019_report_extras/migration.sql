-- Installer 2.0.1 (planner, 2026-10-01): every report carries the Extras tab's state on that PC: what is switched on,
-- the last Apply, the checks and what the game's own log says. Null on reports from older installers.

-- AlterTable
ALTER TABLE "InstallReport" ADD COLUMN "extras" JSONB;
