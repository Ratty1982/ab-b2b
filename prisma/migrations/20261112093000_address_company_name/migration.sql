-- Address-specific company name for billing and delivery.
-- Existing rows stay null. Already exported order snapshots are not rewritten.
ALTER TABLE "Address" ADD COLUMN "companyName" TEXT;
