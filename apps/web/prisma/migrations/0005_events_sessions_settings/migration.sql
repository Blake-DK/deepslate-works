-- docs/16: Session, Event and Setting tables. AuditLog rows move into Event; the old table is kept
-- under another name until a later migration drops it, so nothing is lost if this needs undoing.

-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('JOIN', 'LEAVE', 'DEATH', 'CHAT', 'ADVANCEMENT', 'SERVER_START', 'SERVER_STOP', 'CRASH', 'WARN', 'ERROR', 'ADMIN_ACTION', 'PLAYER_ACTION', 'LINK', 'REVOKE', 'SYNC', 'BACKUP');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "mcUuid" TEXT NOT NULL,
    "mcName" TEXT NOT NULL,
    "userId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL,
    "leftAt" TIMESTAMP(3),
    "ip" TEXT,
    "country" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "EventKind" NOT NULL,
    "actor" TEXT,
    "message" TEXT NOT NULL,
    "raw" TEXT,
    "meta" JSONB,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Session_mcUuid_joinedAt_idx" ON "Session"("mcUuid", "joinedAt");
CREATE INDEX "Session_joinedAt_idx" ON "Session"("joinedAt");
CREATE INDEX "Session_leftAt_idx" ON "Session"("leftAt");
CREATE INDEX "Event_at_idx" ON "Event"("at");
CREATE INDEX "Event_kind_at_idx" ON "Event"("kind", "at");
CREATE INDEX "Event_actor_at_idx" ON "Event"("actor", "at");

-- Move the audit log into the event log. The kind follows the action; portal actions by an admin are
-- ADMIN_ACTION, by anyone else (or nobody) PLAYER_ACTION.
INSERT INTO "Event" ("at", "kind", "actor", "message", "meta")
SELECT a."createdAt",
       (CASE
          WHEN a."action" IN ('link.bind', 'link.release') THEN 'LINK'
          WHEN a."action" IN ('player.revoke', 'user.remove', 'user.clearMinecraft') THEN 'REVOKE'
          WHEN a."action" LIKE 'modpack.sync%' THEN 'SYNC'
          WHEN a."action" = 'server.backup' THEN 'BACKUP'
          WHEN u."role" = 'ADMIN' THEN 'ADMIN_ACTION'
          ELSE 'PLAYER_ACTION'
        END)::"EventKind",
       a."userId",
       COALESCE(u."displayName", 'Someone') || ': ' || a."action"
         || (CASE WHEN a."result" <> 'OK' THEN ' (' || lower(a."result") || ')' ELSE '' END),
       jsonb_build_object('action', a."action", 'params', a."params", 'result', a."result", 'detail', a."detail", 'from', 'AuditLog')
FROM "AuditLog" a LEFT JOIN "User" u ON u."id" = a."userId"
ORDER BY a."createdAt";

-- Keep the old rows out of the way rather than dropping them now.
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";
ALTER INDEX "AuditLog_createdAt_idx" RENAME TO "AuditLog_migrated_createdAt_idx";
ALTER TABLE "AuditLog" RENAME CONSTRAINT "AuditLog_pkey" TO "AuditLog_migrated_pkey";
ALTER TABLE "AuditLog" RENAME TO "AuditLog_migrated_20260929";
