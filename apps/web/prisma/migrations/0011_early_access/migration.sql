-- docs/13 "Early access": a member who may use the portal as if it were live while it is not.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "earlyAccess" BOOLEAN NOT NULL DEFAULT false;
