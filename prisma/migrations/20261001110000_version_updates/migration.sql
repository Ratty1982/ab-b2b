-- Internal Version Updates / What's New

CREATE TYPE "VersionUpdateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "VersionUpdate" (
  "id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "content" JSONB NOT NULL,
  "status" "VersionUpdateStatus" NOT NULL DEFAULT 'DRAFT',
  "audience" JSONB NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "publishedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VersionUpdate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VersionUpdate_status_publishedAt_idx" ON "VersionUpdate"("status", "publishedAt");
CREATE INDEX "VersionUpdate_createdAt_idx" ON "VersionUpdate"("createdAt");

CREATE TABLE "VersionUpdateRead" (
  "id" TEXT NOT NULL,
  "versionUpdateId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VersionUpdateRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VersionUpdateRead_versionUpdateId_userId_key"
  ON "VersionUpdateRead"("versionUpdateId", "userId");
CREATE INDEX "VersionUpdateRead_userId_acknowledgedAt_idx"
  ON "VersionUpdateRead"("userId", "acknowledgedAt");
CREATE INDEX "VersionUpdateRead_versionUpdateId_idx"
  ON "VersionUpdateRead"("versionUpdateId");

ALTER TABLE "VersionUpdateRead"
  ADD CONSTRAINT "VersionUpdateRead_versionUpdateId_fkey"
  FOREIGN KEY ("versionUpdateId") REFERENCES "VersionUpdate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
