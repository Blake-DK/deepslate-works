-- Alex, 2026-10-14: admins can join during the site's Maintenance by default (docs/48 B1's tick, "Can join during
-- maintenance"). Every admin there is now gets the tick; new admins get it when they are made admin. It can still be
-- taken away from one admin in their menu on People → Members. Players never have it.
UPDATE "User" SET "maintenanceJoin" = true WHERE "role" = 'ADMIN';
