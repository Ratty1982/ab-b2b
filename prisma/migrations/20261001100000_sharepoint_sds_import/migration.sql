-- SharePoint / OneDrive SDS source settings + server-side scan sessions.

CREATE TABLE "SharePointSdsSettings" (
  "id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "sourceLabel" TEXT NOT NULL DEFAULT 'Power Maxed SDS',
  "folderDisplayName" TEXT NOT NULL DEFAULT 'Power Maxed SDS 2025',
  "folderUrlHint" TEXT,
  "tenantId" TEXT,
  "clientId" TEXT,
  "clientSecretEncrypted" TEXT,
  "userPrincipalName" TEXT,
  "driveId" TEXT,
  "folderItemId" TEXT,
  "lastConnectionTestAt" TIMESTAMP(3),
  "lastConnectionTestOk" BOOLEAN,
  "lastConnectionTestError" TEXT,
  "lastScanAt" TIMESTAMP(3),
  "lastScanError" TEXT,
  "lastScanFileCount" INTEGER,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SharePointSdsSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SharePointSdsScanSession" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'READY',
  "createdByUserId" TEXT NOT NULL,
  "driveId" TEXT NOT NULL,
  "folderItemId" TEXT NOT NULL,
  "folderName" TEXT,
  "summaryJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "SharePointSdsScanSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SharePointSdsScanSession_createdByUserId_createdAt_idx"
  ON "SharePointSdsScanSession"("createdByUserId", "createdAt");
CREATE INDEX "SharePointSdsScanSession_status_idx"
  ON "SharePointSdsScanSession"("status");

CREATE TABLE "SharePointSdsScanItem" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "clientKey" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "graphItemId" TEXT,
  "graphEtag" TEXT,
  "graphCtag" TEXT,
  "graphLastModified" TIMESTAMP(3),
  "sizeBytes" INTEGER NOT NULL DEFAULT 0,
  "checksumSha256" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL,
  "message" TEXT NOT NULL DEFAULT '',
  "productId" TEXT,
  "productName" TEXT,
  "sku" TEXT,
  "candidatesJson" JSONB,
  "existingDocumentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SharePointSdsScanItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SharePointSdsScanItem_sessionId_clientKey_key"
  ON "SharePointSdsScanItem"("sessionId", "clientKey");
CREATE INDEX "SharePointSdsScanItem_sessionId_status_idx"
  ON "SharePointSdsScanItem"("sessionId", "status");
CREATE INDEX "SharePointSdsScanItem_productId_idx"
  ON "SharePointSdsScanItem"("productId");

ALTER TABLE "SharePointSdsScanItem"
  ADD CONSTRAINT "SharePointSdsScanItem_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "SharePointSdsScanSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
