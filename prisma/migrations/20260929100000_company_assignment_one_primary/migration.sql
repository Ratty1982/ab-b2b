-- Ensure at most one current (isPrimary) CompanyAssignment per company.
-- Keep the newest primary; demote older duplicates left by legacy bugs.

UPDATE "CompanyAssignment" AS ca
SET "isPrimary" = false
WHERE ca."isPrimary" = true
  AND EXISTS (
    SELECT 1
    FROM "CompanyAssignment" AS newer
    WHERE newer."companyId" = ca."companyId"
      AND newer."isPrimary" = true
      AND (
        newer."createdAt" > ca."createdAt"
        OR (newer."createdAt" = ca."createdAt" AND newer."id" > ca."id")
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS "CompanyAssignment_companyId_isPrimary_unique"
ON "CompanyAssignment" ("companyId")
WHERE "isPrimary" = true;
