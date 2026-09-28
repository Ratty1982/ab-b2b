-- Step 1: add INHERIT enum value + global settings table.
-- PostgreSQL requires the new BackorderPolicy value to be committed before use,
-- so DEFAULT/UPDATE that reference INHERIT live in the next migration.

DO $$ BEGIN
  CREATE TYPE "EffectiveBackorderPolicy" AS ENUM ('ALLOW', 'DENY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TYPE "BackorderPolicy" ADD VALUE IF NOT EXISTS 'INHERIT';

CREATE TABLE IF NOT EXISTS "TradeOrderingSettings" (
  "id" TEXT NOT NULL,
  "defaultBackorderPolicy" "EffectiveBackorderPolicy" NOT NULL DEFAULT 'ALLOW',
  "updatedByUserId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradeOrderingSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "TradeOrderingSettings" ("id", "defaultBackorderPolicy", "updatedAt")
VALUES ('singleton', 'ALLOW', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
