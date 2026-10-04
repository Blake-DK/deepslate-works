-- docs/31 B-02 to B-04, the planner's ruling of 2026-10-04: who the entrance room holds, why, and where they stood,
-- kept in the database. It was only in api's memory, so a leave or a restart of api lost it: a member held twice
-- was sealed in the room or sent to spawn instead of their base, and a deploy orphaned whoever was being held.

-- CreateTable
CREATE TABLE "HeldPlayer" (
    "mcUuid" TEXT NOT NULL,
    "mcUsername" TEXT NOT NULL,
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "codeId" TEXT,
    "backDim" TEXT,
    "backX" DOUBLE PRECISION,
    "backY" DOUBLE PRECISION,
    "backZ" DOUBLE PRECISION,

    CONSTRAINT "HeldPlayer_pkey" PRIMARY KEY ("mcUuid")
);

-- CreateIndex
CREATE INDEX "HeldPlayer_mcUsername_idx" ON "HeldPlayer"("mcUsername");
