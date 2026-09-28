-- Stock sync issue severity: ignored feed noise vs actionable/fatal conditions.

DO $$ BEGIN
  CREATE TYPE "StockIssueSeverity" AS ENUM (
    'IGNORED',
    'WARNING',
    'ACTION_REQUIRED',
    'FATAL'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "StockSyncIssue"
  ADD COLUMN IF NOT EXISTS "severity" "StockIssueSeverity" NOT NULL DEFAULT 'IGNORED';

-- Historical INVALID/DUPLICATE diagnostics are non-actionable for dashboard health.
UPDATE "StockSyncIssue"
SET "severity" = 'IGNORED'
WHERE "kind" IN ('INVALID', 'DUPLICATE', 'UNMATCHED');

UPDATE "StockSyncIssue"
SET "severity" = 'ACTION_REQUIRED'
WHERE "kind" = 'CONFLICT';

UPDATE "StockSyncIssue"
SET "severity" = 'FATAL'
WHERE "kind" = 'PARSE';

CREATE INDEX IF NOT EXISTS "StockSyncIssue_runId_severity_idx"
  ON "StockSyncIssue"("runId", "severity");
