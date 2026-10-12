-- docs/57, testers (planner and Alex, 2026-10-12): a member who gets the app's Test tab and the test server without
-- being an admin, turned on and off with one click on Admin → People. Off for everyone after this migration.
-- testerAt is when it was last turned on, for "Tester since".

-- AlterTable
ALTER TABLE "User" ADD COLUMN "tester" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "testerAt" TIMESTAMP(3);
