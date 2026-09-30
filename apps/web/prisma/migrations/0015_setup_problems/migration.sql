-- Installer 1.5.6 (planner, 2026-09-30): what Setup or a later run could not set up on the PC (the home copy, the Play
-- link, the shortcuts, the Settings -> Apps entry), with a reason code, and whether the Play button is left without a
-- working link. Null on reports from older installers, which do not say.

-- AlterTable
ALTER TABLE "InstallReport" ADD COLUMN "setupProblems" JSONB;
ALTER TABLE "InstallReport" ADD COLUMN "playLinkMissing" BOOLEAN;
