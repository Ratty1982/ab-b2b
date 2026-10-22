-- One cutover row per customer. Ongoing 504/TRM21QC sales are stored only after
-- historyStatus is COMPLETE. Creating or activating a customer does not insert a row.

CREATE TYPE "CustomerSalesHistoryStatus" AS ENUM ('NOT_STARTED', 'COMPLETE');

CREATE TABLE "CustomerSalesCutover" (
    "companyId" TEXT NOT NULL,
    "historyStatus" "CustomerSalesHistoryStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "historyFrom" TIMESTAMP(3),
    "historyTo" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSalesCutover_pkey" PRIMARY KEY ("companyId")
);

ALTER TABLE "CustomerSalesCutover"
  ADD CONSTRAINT "CustomerSalesCutover_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerSalesCutover"
  ADD CONSTRAINT "CustomerSalesCutover_completedById_fkey"
  FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
