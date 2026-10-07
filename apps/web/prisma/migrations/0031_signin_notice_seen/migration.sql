-- The admin sign-in notice can be acknowledged (Alex, 2026-10-07): each admin's "seen up to" time. The notice lists
-- only password and one-time-link sign-ins newer than it. Null: nothing acknowledged, the notice shows the last 24 hours.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "signInNoticeSeenAt" TIMESTAMP(3);
