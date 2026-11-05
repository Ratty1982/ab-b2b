-- Website chrome branding: header logo reference (bytes stay on CmsMedia / object storage).
CREATE TABLE IF NOT EXISTS "SiteBrandingSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "headerLogoMediaId" TEXT,
    "headerLogoAlt" TEXT,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteBrandingSettings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SiteBrandingSettings_headerLogoMediaId_idx" ON "SiteBrandingSettings"("headerLogoMediaId");

DO $$ BEGIN
  ALTER TABLE "SiteBrandingSettings"
    ADD CONSTRAINT "SiteBrandingSettings_headerLogoMediaId_fkey"
    FOREIGN KEY ("headerLogoMediaId") REFERENCES "CmsMedia"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
