-- Allow historic confirm imports to record in-progress vs success/failure.
ALTER TYPE "AutopartCustomerImportStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
