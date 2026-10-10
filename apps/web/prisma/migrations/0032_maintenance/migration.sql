-- docs/48 Part B: the site's Maintenance (not AMP's state of that name). One switch in the site's settings, and one
-- tick per admin, "Can join during maintenance". Off after this migration; nobody has the tick.

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN "maintenance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "maintenanceAt" TIMESTAMP(3),
ADD COLUMN "maintenanceById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "maintenanceJoin" BOOLEAN NOT NULL DEFAULT false;
