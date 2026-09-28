-- Historical prepared-by details for sent/converted quotations (email + print).
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "preparedBySnapshot" JSONB;
