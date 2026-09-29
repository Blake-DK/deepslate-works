-- docs/05 "Play from the site": a report says whether it came from Setup.bat ("install") or from the Play button ("play").
-- Reports from before there was a Play button are installs.

-- AlterTable
ALTER TABLE "InstallReport" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'install';
