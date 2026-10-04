-- docs/30 §6, app 3.5.0: the app's Settings tab on the PC (memory chosen and given, render distance, villagers), from
-- each install report that says. Older apps send none: null.

-- AlterTable
ALTER TABLE "InstallReport" ADD COLUMN "settings" JSONB;
