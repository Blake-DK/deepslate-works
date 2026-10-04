-- docs/20 §7, docs/34 §4 (W1.3): seasons. A row per season the portal knows of, a row per player's tick on a boss
-- or trial, and an event kind of their own for what a season says (a boss fell, a trial opened, the goal's marks).

-- AlterEnum
ALTER TYPE "EventKind" ADD VALUE 'SEASON';

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'upcoming',
    "marks" JSONB NOT NULL DEFAULT '{}',
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonClear" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "mcUuid" TEXT NOT NULL,
    "mcName" TEXT NOT NULL,
    "userId" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "first" BOOLEAN NOT NULL DEFAULT false,
    "early" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'console',

    CONSTRAINT "SeasonClear_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeasonClear_seasonId_kind_itemId_mcUuid_key" ON "SeasonClear"("seasonId", "kind", "itemId", "mcUuid");

-- CreateIndex
CREATE INDEX "SeasonClear_seasonId_at_idx" ON "SeasonClear"("seasonId", "at");

-- CreateIndex
CREATE INDEX "SeasonClear_mcUuid_idx" ON "SeasonClear"("mcUuid");

-- AddForeignKey
ALTER TABLE "SeasonClear" ADD CONSTRAINT "SeasonClear_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;
