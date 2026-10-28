-- Explicit Super Admin approval for RETAILA sales-based FBA planning.
-- Does not change Autopart invoices, Amazon extracts, or stock quantities.

ALTER TABLE "FbaForecastSettings"
  ADD COLUMN "retailaPlanningEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "retailaPlanningJustification" TEXT,
  ADD COLUMN "retailaPlanningScope" TEXT,
  ADD COLUMN "retailaPlanningApprovedByUserId" TEXT,
  ADD COLUMN "retailaPlanningApprovedAt" TIMESTAMP(3),
  ADD COLUMN "retailaPlanningDisabledByUserId" TEXT,
  ADD COLUMN "retailaPlanningDisabledAt" TIMESTAMP(3);
