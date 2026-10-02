-- docs/22, the Discord bot: a message posted by the bot (votes with buttons) is edited by the bot, and forum posts
-- (docs/22 §13) keep the thread they opened.

-- AlterTable
ALTER TABLE "DiscordPost" ADD COLUMN "via" TEXT NOT NULL DEFAULT 'webhook',
ADD COLUMN "threadId" TEXT;
