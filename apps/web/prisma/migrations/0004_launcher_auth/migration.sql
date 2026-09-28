-- CreateTable
CREATE TABLE "LauncherAuth" (
    "code" TEXT NOT NULL,
    "pollToken" TEXT NOT NULL,
    "tokenHash" TEXT,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "hostname" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "LauncherAuth_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "LauncherAuth_pollToken_key" ON "LauncherAuth"("pollToken");

-- CreateIndex
CREATE UNIQUE INDEX "LauncherAuth_tokenHash_key" ON "LauncherAuth"("tokenHash");

-- AddForeignKey
ALTER TABLE "LauncherAuth" ADD CONSTRAINT "LauncherAuth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

