-- Retire leftover 504C feed settings. Historical import runs, invoices,
-- fulfilment events, and financial rows stay in place.
ALTER TABLE "Autopart504cFeedSettings"
  ALTER COLUMN "runtimeMode" SET DEFAULT 'RETIRED';

UPDATE "Autopart504cFeedSettings"
SET "enabled" = false,
    "runtimeMode" = 'RETIRED',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "runtimeMode" <> 'RETIRED' OR "enabled" = true;
