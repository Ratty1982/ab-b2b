-- Additive enums for staff manual order resolution.
-- New values are not used in this migration so PostgreSQL can commit them first.

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'ADMINISTRATIVELY_CLOSED';
ALTER TYPE "OrderFulfilmentEventKind" ADD VALUE IF NOT EXISTS 'ADMINISTRATIVELY_CLOSED';
ALTER TYPE "AutopartDocumentFulfilmentStatus" ADD VALUE IF NOT EXISTS 'FINANCIAL_LINKED';

DO $$
BEGIN
  CREATE TYPE "OrderManualResolutionKind" AS ENUM ('NONE', 'FULFILLED_MANUALLY', 'CLOSED_ADMINISTRATIVELY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "OrderInvoiceEvidence" AS ENUM ('NOT_RECORDED', 'OUTSTANDING', 'UNAVAILABLE', 'LINKED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
