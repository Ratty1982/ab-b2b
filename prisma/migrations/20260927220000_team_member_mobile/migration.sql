-- Optional customer-facing mobile for TeamMember (Account Manager contact)
ALTER TABLE "TeamMember" ADD COLUMN IF NOT EXISTS "mobile" TEXT;
