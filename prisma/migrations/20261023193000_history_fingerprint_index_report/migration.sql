-- Report clearly whether the guarded 561L fingerprint unique index is present.
-- Create it when safe; warn when duplicate fingerprints still block creation.

DO $$
DECLARE
  has_duplicates boolean;
  has_index boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE indexname = 'AutopartSalesLine_company_561l_fingerprint_uidx'
  ) INTO has_index;

  IF has_index THEN
    RAISE NOTICE 'AutopartSalesLine_company_561l_fingerprint_uidx is present';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM "AutopartSalesLine"
    WHERE "source" = '561L'
      AND "companyId" IS NOT NULL
      AND "sourceFingerprint" IS NOT NULL
    GROUP BY "companyId", "sourceFingerprint"
    HAVING COUNT(*) > 1
  ) INTO has_duplicates;

  IF has_duplicates THEN
    RAISE WARNING 'AutopartSalesLine_company_561l_fingerprint_uidx was not created: duplicate 561L fingerprints exist for one or more companies. Resolve duplicates before creating the unique index.';
    RETURN;
  END IF;

  CREATE UNIQUE INDEX "AutopartSalesLine_company_561l_fingerprint_uidx"
    ON "AutopartSalesLine" ("companyId", "sourceFingerprint")
    WHERE "source" = '561L' AND "companyId" IS NOT NULL AND "sourceFingerprint" IS NOT NULL;
  RAISE NOTICE 'Created AutopartSalesLine_company_561l_fingerprint_uidx';
END $$;
