-- docs/07 "The installer updates itself": which version fetched the one that ran, or why an update that was due was not applied.

-- AlterTable
ALTER TABLE "InstallReport" ADD COLUMN "updatedFrom" TEXT,
ADD COLUMN "updateProblem" TEXT;
