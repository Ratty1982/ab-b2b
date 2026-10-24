-- Customer Autopart workspace looks up outstanding ongoing-import diagnostics by company.
CREATE INDEX IF NOT EXISTS "AutopartImportDiagnostic_companyId_createdAt_idx"
  ON "AutopartImportDiagnostic" ("companyId", "createdAt" DESC)
  WHERE "companyId" IS NOT NULL;
