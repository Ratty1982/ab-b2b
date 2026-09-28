-- AlterEnum
ALTER TYPE "AutopartCustomerImportType" ADD VALUE 'CREDIT_407P100_BULK';

-- AlterTable: bulk 407P100 runs have no single company
ALTER TABLE "AutopartCustomerImportRun" ALTER COLUMN "companyId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "AutopartCustomerImportRun_type_status_createdAt_idx" ON "AutopartCustomerImportRun"("type", "status", "createdAt");
