-- docs/05: a news item may be pinned until a date, and may stop being shown from a date. Both optional.

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN "pinnedUntil" TIMESTAMP(3),
ADD COLUMN "expiresAt" TIMESTAMP(3);
