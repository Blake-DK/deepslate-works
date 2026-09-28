-- AlterTable
ALTER TABLE "User" ADD COLUMN     "guildMember" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LinkCode" (
    "code" TEXT NOT NULL,
    "mcUuid" TEXT NOT NULL,
    "mcUsername" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedById" TEXT,

    CONSTRAINT "LinkCode_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "LinkCode_mcUuid_idx" ON "LinkCode"("mcUuid");

