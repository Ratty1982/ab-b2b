-- Historical 561L/SLRB imports must not replace ongoing TRM21QC lines or 504/TRM headers.
-- The historic upsert also skips these rows in its ON CONFLICT WHERE clause.
-- These triggers cover any other UPDATE/INSERT in the same statement, including a
-- concurrent commit that lands between the importer's read and its write.
-- Ongoing 504 and TRM21QC runs, fulfilment status updates, and account mapping
-- do not use a HISTORY_561L_SLRB import run, so they are left unchanged.
-- No existing financial rows are updated by this migration.

CREATE OR REPLACE FUNCTION "protect_autopart_sales_line_from_historic"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_type text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF OLD."source" IS DISTINCT FROM 'ONGOING_TRM21QC' THEN
    RETURN NEW;
  END IF;
  IF NEW."source" IS DISTINCT FROM 'ONGOING_TRM21QC' THEN
    RETURN NULL;
  END IF;
  SELECT r."type"::text INTO run_type
  FROM "AutopartCustomerImportRun" r
  WHERE r."id" = NEW."importRunId";
  IF run_type = 'HISTORY_561L_SLRB' THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "autopart_sales_line_protect_ongoing" ON "AutopartSalesLine";
CREATE TRIGGER "autopart_sales_line_protect_ongoing"
  BEFORE UPDATE ON "AutopartSalesLine"
  FOR EACH ROW
  EXECUTE FUNCTION "protect_autopart_sales_line_from_historic"();

CREATE OR REPLACE FUNCTION "protect_autopart_sales_document_from_historic"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_type text;
  protected boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "AutopartCustomerImportRun" r
      WHERE r."id" = NEW."importRunId"
        AND r."type"::text = 'HISTORY_561L_SLRB'
    ) THEN
      RETURN NEW;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM "AutopartSalesDocument" d
      WHERE d."documentType" = NEW."documentType"
        AND d."documentReference" = NEW."documentReference"
        AND (d."has504" OR d."hasTrm21qc" OR d."source" IN ('ONGOING_504', 'ONGOING_TRM21QC', 'ONGOING_504_BRIDGE'))
    ) THEN
      RETURN NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  protected := OLD."has504" OR OLD."hasTrm21qc"
    OR OLD."source" IN ('ONGOING_504', 'ONGOING_TRM21QC', 'ONGOING_504_BRIDGE');
  IF NOT protected THEN
    RETURN NEW;
  END IF;
  SELECT r."type"::text INTO run_type
  FROM "AutopartCustomerImportRun" r
  WHERE r."id" = NEW."importRunId";
  IF run_type = 'HISTORY_561L_SLRB' THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "autopart_sales_document_protect_ongoing" ON "AutopartSalesDocument";
CREATE TRIGGER "autopart_sales_document_protect_ongoing"
  BEFORE INSERT OR UPDATE ON "AutopartSalesDocument"
  FOR EACH ROW
  EXECUTE FUNCTION "protect_autopart_sales_document_from_historic"();
