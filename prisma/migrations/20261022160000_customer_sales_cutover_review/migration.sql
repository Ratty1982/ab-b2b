-- REVIEW is not completion. Ongoing sales stay blocked until a person accepts the exceptions
-- or replaces the file with one that has none. Existing databases already have the enum.

ALTER TYPE "CustomerSalesHistoryStatus" ADD VALUE IF NOT EXISTS 'REVIEW';
