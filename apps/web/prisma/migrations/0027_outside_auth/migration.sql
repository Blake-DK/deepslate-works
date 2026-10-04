-- Came in by an invite link: the Discord server rule (docs/14 §7) is not applied to them. People → Members lists them.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "outsideAuth" BOOLEAN NOT NULL DEFAULT false;
