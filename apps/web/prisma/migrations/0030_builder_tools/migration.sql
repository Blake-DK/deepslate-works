-- docs/37 Step 2: Builder tools, ticked per admin on People. With it, the admin may switch Builder mode (creative,
-- where WorldEdit works) on for themselves from Admin → Seasons → Builds.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "builderTools" BOOLEAN NOT NULL DEFAULT false;
