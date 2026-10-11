-- Game chat to Discord, per member (Alex, 2026-10-11): an admin picks Automatic, Always post or Never post.
-- Automatic is the docs/50 rule and every member has it after this migration, so nothing changes until an admin picks.

-- CreateEnum
CREATE TYPE "ChatRelay" AS ENUM ('AUTO', 'ALWAYS', 'NEVER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "chatRelay" "ChatRelay" NOT NULL DEFAULT 'AUTO';
