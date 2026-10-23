-- Bulk historic confirmation sets importRunId on every new header.
-- The previous guard compared companyId with IS NOT DISTINCT FROM, which could
-- not use the document unique index and scanned the table once per inserted row.
-- A known company uses that unique index. Unmatched NULL company ids keep the
-- original comparison.

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
    IF NEW."companyId" IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
        FROM "AutopartSalesDocument" d
        WHERE d."companyId" = NEW."companyId"
          AND d."documentType" = NEW."documentType"
          AND d."documentReference" = NEW."documentReference"
          AND (
            d."has504"
            OR d."hasTrm21qc"
            OR d."source" IN ('ONGOING_504', 'ONGOING_TRM21QC', 'ONGOING_504_BRIDGE')
          )
      ) THEN
        RETURN NULL;
      END IF;
      RETURN NEW;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM "AutopartSalesDocument" d
      WHERE d."documentType" IS NOT DISTINCT FROM NEW."documentType"
        AND d."documentReference" IS NOT DISTINCT FROM NEW."documentReference"
        AND d."companyId" IS NOT DISTINCT FROM NEW."companyId"
        AND (
          d."has504"
          OR d."hasTrm21qc"
          OR d."source" IN ('ONGOING_504', 'ONGOING_TRM21QC', 'ONGOING_504_BRIDGE')
        )
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
