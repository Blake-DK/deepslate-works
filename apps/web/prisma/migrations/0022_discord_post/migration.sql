-- docs/21, the Discord feed: messages the feed edits after posting them (a vote kept up to date, a run of deaths).

-- CreateTable
CREATE TABLE "DiscordPost" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "DiscordPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscordPost_key_key" ON "DiscordPost"("key");
