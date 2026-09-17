-- AlterTable
ALTER TABLE "Brand" ADD COLUMN "logoMediaId" TEXT;
ALTER TABLE "Brand" ADD COLUMN "logoAlt" TEXT;

-- CreateIndex
CREATE INDEX "Brand_logoMediaId_idx" ON "Brand"("logoMediaId");

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_logoMediaId_fkey" FOREIGN KEY ("logoMediaId") REFERENCES "CmsMedia"("id") ON DELETE SET NULL ON UPDATE CASCADE;
