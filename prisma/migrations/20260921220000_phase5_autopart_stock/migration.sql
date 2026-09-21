-- Phase 5 Autopart stock: diagnostic raw Avail, sync run history, unmatched feed SKUs.
-- Additive. Does not reset Inventory quantities.

ALTER TABLE "Inventory" ADD COLUMN "sourceAvailRaw" TEXT;

CREATE TYPE "StockSyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');
CREATE TYPE "StockIssueKind" AS ENUM ('UNMATCHED', 'INVALID', 'DUPLICATE', 'PARSE', 'CONFLICT');

CREATE TABLE "StockSyncRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" "StockSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "unmatched" INTEGER NOT NULL DEFAULT 0,
    "invalid" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "absentFromFeed" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "actorUserId" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockSyncRun_startedAt_idx" ON "StockSyncRun"("startedAt");
CREATE INDEX "StockSyncRun_status_startedAt_idx" ON "StockSyncRun"("status", "startedAt");

CREATE TABLE "StockSyncIssue" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" "StockIssueKind" NOT NULL,
    "sku" TEXT,
    "description" TEXT,
    "availRaw" TEXT,
    "message" TEXT NOT NULL,
    "line" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockSyncIssue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockSyncIssue_runId_kind_idx" ON "StockSyncIssue"("runId", "kind");

ALTER TABLE "StockSyncIssue" ADD CONSTRAINT "StockSyncIssue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StockSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StockFeedUnmatched" (
    "sku" TEXT NOT NULL,
    "description" TEXT,
    "lastAvailRaw" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "lastRunId" TEXT NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT NOT NULL,

    CONSTRAINT "StockFeedUnmatched_pkey" PRIMARY KEY ("sku")
);

CREATE TABLE "StockSyncMutex" (
    "id" TEXT NOT NULL,
    "holder" TEXT,
    "lockedAt" TIMESTAMP(3),

    CONSTRAINT "StockSyncMutex_pkey" PRIMARY KEY ("id")
);

INSERT INTO "StockSyncMutex" ("id") VALUES ('autopart-231po3new');
