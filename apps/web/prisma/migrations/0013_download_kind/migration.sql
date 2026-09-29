-- The download log (Alex, 2026-09-29): who fetched the installer, the settings or the mod list from the site,
-- and who was refused. Files an admin takes from the server (Admin → Files) are of this kind too from now on.

-- AlterEnum
ALTER TYPE "EventKind" ADD VALUE 'DOWNLOAD';
