-- Existing products have no recorded creation/update dates. Preserve that
-- uncertainty instead of assigning the deployment time as their history.
ALTER TABLE "produtos"
ADD COLUMN "createdAt" TIMESTAMP(3),
ADD COLUMN "updatedAt" TIMESTAMP(3);

-- Defaults apply only to future inserts. Prisma's @updatedAt maintains the
-- update date for edits, status changes and photo replacement/removal.
ALTER TABLE "produtos"
ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "produtos_updatedAt_id_idx"
ON "produtos"("updatedAt" DESC, "id" DESC);
