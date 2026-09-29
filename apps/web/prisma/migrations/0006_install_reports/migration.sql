-- docs/07 "Install reports": what the installer sends at the end of a run, and its kind in the event log.

-- AlterEnum
ALTER TYPE "EventKind" ADD VALUE 'INSTALL';

-- CreateTable
CREATE TABLE "InstallReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "packVersion" TEXT NOT NULL,
    "installerVersion" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "failedStep" TEXT,
    "durationSec" INTEGER NOT NULL,
    "system" JSONB NOT NULL,
    "log" TEXT NOT NULL,
    "tierBefore" TEXT,
    "tierMeasured" TEXT,

    CONSTRAINT "InstallReport_pkey" PRIMARY KEY ("id")
);

-- AlterTable: the PC tier is measured by the installer from now on (Alex, 2026-09-29)
ALTER TABLE "User" ADD COLUMN "pcTierSource" TEXT NOT NULL DEFAULT 'self',
ADD COLUMN "pcTierWhy" TEXT,
ADD COLUMN "pcTierAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "InstallReport_at_idx" ON "InstallReport"("at");
CREATE INDEX "InstallReport_userId_at_idx" ON "InstallReport"("userId", "at");

-- AddForeignKey
ALTER TABLE "InstallReport" ADD CONSTRAINT "InstallReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
