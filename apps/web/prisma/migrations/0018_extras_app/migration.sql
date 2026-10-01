-- The Deepslate Works app (planner, 2026-10-01): visual extras moved from the Me page into the app's Extras tab, chosen
-- on the PC (extras.json there), so the two Me page columns of 0016 go. A member who declines install reports in the
-- app still sends "pressed Play, pack version" for Play first: such a report is marked minimal.

-- AlterTable
ALTER TABLE "User" DROP COLUMN "visualExtras";
ALTER TABLE "User" DROP COLUMN "shaders";

-- AlterTable
ALTER TABLE "InstallReport" ADD COLUMN "minimal" BOOLEAN NOT NULL DEFAULT false;
