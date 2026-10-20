-- docs/04, sign-in through Authentik (Alex, 2026-10-20): the Authentik user an account is linked to, by its `sub`.
-- Set at the account's first sign-in through Authentik, which finds the account by its Discord ID. Empty for everyone
-- after this migration; nothing else changes.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "authentikSub" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_authentikSub_key" ON "User"("authentikSub");
