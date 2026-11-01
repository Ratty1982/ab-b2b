-- Additive Microsoft 365 CRM connection foundation.
-- Does not alter Task rows, orders, stock, or Autopart imports.
-- Sync tables are unused until a later release. The integration stays off
-- unless MICROSOFT_365_CRM_ENABLED is explicitly turned on.

CREATE TYPE "MicrosoftConnectionStatus" AS ENUM ('CONNECTED', 'REVOKED', 'ERROR');
CREATE TYPE "MicrosoftSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'CONFLICT', 'SKIPPED', 'TOMBSTONED');
CREATE TYPE "MicrosoftSyncJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

CREATE TABLE "MicrosoftAccountConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "MicrosoftConnectionStatus" NOT NULL DEFAULT 'REVOKED',
  "tenantId" TEXT NOT NULL,
  "microsoftUserId" TEXT NOT NULL,
  "activeIdentityKey" TEXT,
  "microsoftEmail" TEXT,
  "displayName" TEXT,
  "scopes" TEXT NOT NULL DEFAULT '',
  "taskSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
  "calendarSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
  "accessTokenEncrypted" TEXT,
  "refreshTokenEncrypted" TEXT,
  "accessTokenExpiresAt" TIMESTAMP(3),
  "lastTokenRefreshAt" TIMESTAMP(3),
  "lastTaskSyncAt" TIMESTAMP(3),
  "lastCalendarSyncAt" TIMESTAMP(3),
  "lastError" TEXT,
  "connectedAt" TIMESTAMP(3),
  "disconnectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MicrosoftAccountConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MicrosoftAccountConnection_userId_key" ON "MicrosoftAccountConnection"("userId");
CREATE UNIQUE INDEX "MicrosoftAccountConnection_activeIdentityKey_key" ON "MicrosoftAccountConnection"("activeIdentityKey");
CREATE INDEX "MicrosoftAccountConnection_status_idx" ON "MicrosoftAccountConnection"("status");
CREATE INDEX "MicrosoftAccountConnection_tenantId_microsoftUserId_idx" ON "MicrosoftAccountConnection"("tenantId", "microsoftUserId");

ALTER TABLE "MicrosoftAccountConnection"
  ADD CONSTRAINT "MicrosoftAccountConnection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MicrosoftOAuthTransaction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "codeVerifierEncrypted" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "includeCalendar" BOOLEAN NOT NULL DEFAULT false,
  "redirectUri" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MicrosoftOAuthTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MicrosoftOAuthTransaction_stateHash_key" ON "MicrosoftOAuthTransaction"("stateHash");
CREATE INDEX "MicrosoftOAuthTransaction_userId_expiresAt_idx" ON "MicrosoftOAuthTransaction"("userId", "expiresAt");

ALTER TABLE "MicrosoftOAuthTransaction"
  ADD CONSTRAINT "MicrosoftOAuthTransaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MicrosoftTaskMapping" (
  "id" TEXT NOT NULL,
  "taskId" TEXT,
  "userId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "microsoftUserId" TEXT NOT NULL,
  "listId" TEXT NOT NULL,
  "microsoftTaskId" TEXT NOT NULL,
  "remoteEtag" TEXT,
  "syncStatus" "MicrosoftSyncStatus" NOT NULL DEFAULT 'PENDING',
  "lastError" TEXT,
  "lastSyncedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MicrosoftTaskMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MicrosoftTaskMapping_userId_taskId_key" ON "MicrosoftTaskMapping"("userId", "taskId");
CREATE UNIQUE INDEX "MicrosoftTaskMapping_tenantId_microsoftUserId_microsoftTaskId_key" ON "MicrosoftTaskMapping"("tenantId", "microsoftUserId", "microsoftTaskId");
CREATE INDEX "MicrosoftTaskMapping_connectionId_syncStatus_idx" ON "MicrosoftTaskMapping"("connectionId", "syncStatus");

ALTER TABLE "MicrosoftTaskMapping"
  ADD CONSTRAINT "MicrosoftTaskMapping_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MicrosoftTaskMapping"
  ADD CONSTRAINT "MicrosoftTaskMapping_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MicrosoftTaskMapping"
  ADD CONSTRAINT "MicrosoftTaskMapping_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "MicrosoftAccountConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MicrosoftSyncCursor" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "deltaLinkEncrypted" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MicrosoftSyncCursor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MicrosoftSyncCursor_connectionId_resource_key" ON "MicrosoftSyncCursor"("connectionId", "resource");

ALTER TABLE "MicrosoftSyncCursor"
  ADD CONSTRAINT "MicrosoftSyncCursor_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "MicrosoftAccountConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MicrosoftSyncJob" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" "MicrosoftSyncJobStatus" NOT NULL DEFAULT 'QUEUED',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MicrosoftSyncJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MicrosoftSyncJob_status_runAfter_idx" ON "MicrosoftSyncJob"("status", "runAfter");
CREATE INDEX "MicrosoftSyncJob_connectionId_kind_status_idx" ON "MicrosoftSyncJob"("connectionId", "kind", "status");

ALTER TABLE "MicrosoftSyncJob"
  ADD CONSTRAINT "MicrosoftSyncJob_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "MicrosoftAccountConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MicrosoftSyncJob"
  ADD CONSTRAINT "MicrosoftSyncJob_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MicrosoftSyncEvent" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT,
  "userId" TEXT,
  "kind" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MicrosoftSyncEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MicrosoftSyncEvent_userId_createdAt_idx" ON "MicrosoftSyncEvent"("userId", "createdAt");
CREATE INDEX "MicrosoftSyncEvent_connectionId_createdAt_idx" ON "MicrosoftSyncEvent"("connectionId", "createdAt");

ALTER TABLE "MicrosoftSyncEvent"
  ADD CONSTRAINT "MicrosoftSyncEvent_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "MicrosoftAccountConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MicrosoftSyncEvent"
  ADD CONSTRAINT "MicrosoftSyncEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MicrosoftCalendarMapping" (
  "id" TEXT NOT NULL,
  "taskId" TEXT,
  "userId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "microsoftEventId" TEXT NOT NULL,
  "syncStatus" "MicrosoftSyncStatus" NOT NULL DEFAULT 'PENDING',
  "externalAttendees" BOOLEAN NOT NULL DEFAULT false,
  "lastError" TEXT,
  "lastSyncedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MicrosoftCalendarMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MicrosoftCalendarMapping_connectionId_microsoftEventId_key" ON "MicrosoftCalendarMapping"("connectionId", "microsoftEventId");
CREATE UNIQUE INDEX "MicrosoftCalendarMapping_userId_taskId_key" ON "MicrosoftCalendarMapping"("userId", "taskId");
CREATE INDEX "MicrosoftCalendarMapping_connectionId_syncStatus_idx" ON "MicrosoftCalendarMapping"("connectionId", "syncStatus");

ALTER TABLE "MicrosoftCalendarMapping"
  ADD CONSTRAINT "MicrosoftCalendarMapping_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MicrosoftCalendarMapping"
  ADD CONSTRAINT "MicrosoftCalendarMapping_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MicrosoftCalendarMapping"
  ADD CONSTRAINT "MicrosoftCalendarMapping_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "MicrosoftAccountConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
