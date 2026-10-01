-- Indexes used by large historic import lookups and Customer Group / SI drill-down.
-- Additive only — supports documentId joins and importRunId evidence checks.

CREATE INDEX IF NOT EXISTS "AutopartSalesDocument_importRunId_idx"
  ON "AutopartSalesDocument" ("importRunId");

CREATE INDEX IF NOT EXISTS "AutopartSalesLine_documentId_idx"
  ON "AutopartSalesLine" ("documentId");

CREATE INDEX IF NOT EXISTS "AutopartSalesLine_importRunId_idx"
  ON "AutopartSalesLine" ("importRunId");
