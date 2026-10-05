-- docs/35 R-01: a member may use more than one invite in their time (came in by one, left the Discord server,
-- was sent a new one). `usedBy` was unique, so the second invite could never be marked as theirs.

-- DropIndex
DROP INDEX "Invite_usedBy_key";

-- CreateIndex
CREATE INDEX "Invite_usedBy_idx" ON "Invite"("usedBy");
