-- App 3.6.6 (Alex, 2026-10-14): a news item can be one every member has to confirm in the app before Play
-- ("must read"), and who confirmed it is kept.
ALTER TABLE "Announcement" ADD COLUMN "mustRead" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AnnouncementSeen" (
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementSeen_pkey" PRIMARY KEY ("announcementId","userId")
);

CREATE INDEX "AnnouncementSeen_userId_idx" ON "AnnouncementSeen"("userId");

ALTER TABLE "AnnouncementSeen" ADD CONSTRAINT "AnnouncementSeen_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnnouncementSeen" ADD CONSTRAINT "AnnouncementSeen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
