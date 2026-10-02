-- Planner 2026-10-02, "votes before play": quick polls (Poll, PollAnswer) and a must-vote switch on the season's mod
-- ballot. A member with an open must-vote poll they have not answered is asked in the app and on the site, and held at
-- the door until they have (admins are asked but never held).

-- AlterTable
ALTER TABLE "Vote" ADD COLUMN "mustVote" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Poll" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "multiple" BOOLEAN NOT NULL DEFAULT false,
    "mustVote" BOOLEAN NOT NULL DEFAULT true,
    "status" "VoteStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,

    CONSTRAINT "Poll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollAnswer" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "choices" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PollAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Poll_status_openedAt_idx" ON "Poll"("status", "openedAt");

-- CreateIndex
CREATE INDEX "PollAnswer_userId_idx" ON "PollAnswer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PollAnswer_pollId_userId_key" ON "PollAnswer"("pollId", "userId");

-- AddForeignKey
ALTER TABLE "PollAnswer" ADD CONSTRAINT "PollAnswer_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollAnswer" ADD CONSTRAINT "PollAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
