-- Admin password sign-in (planner, 2026-10-01): username + password + authenticator code, admins only; break-glass
-- one-time links from the CLI; a session version that ends every session a member has when it is raised.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AdminLogin" (
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecret" TEXT,
    "pendingSecret" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastStep" INTEGER,
    "recovery" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enabledAt" TIMESTAMP(3),
    "passwordAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminLogin_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "OneTimeLogin" (
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OneTimeLogin_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminLogin_username_key" ON "AdminLogin"("username");

-- CreateIndex
CREATE INDEX "OneTimeLogin_userId_idx" ON "OneTimeLogin"("userId");

-- AddForeignKey
ALTER TABLE "AdminLogin" ADD CONSTRAINT "AdminLogin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneTimeLogin" ADD CONSTRAINT "OneTimeLogin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
