-- Visual extras (planner, 2026-10-01): each member chooses on the Me page whether their PC gets the client-only
-- visual mods, and which shader pack. Off and "none" for everyone to start with; the server never has them.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "visualExtras" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "shaders" TEXT NOT NULL DEFAULT 'none';
