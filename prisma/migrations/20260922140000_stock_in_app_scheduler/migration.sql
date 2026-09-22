-- Additive Autopart in-application scheduler state. Does not reset Inventory.

CREATE TABLE "StockScheduleState" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "lastTickAt" TIMESTAMP(3),
    "lastDueKey" TEXT,

    CONSTRAINT "StockScheduleState_pkey" PRIMARY KEY ("id")
);

INSERT INTO "StockScheduleState" ("id") VALUES ('singleton');

CREATE TABLE "StockScheduleWindow" (
    "key" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "hour" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "lastAttemptAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastRunId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockScheduleWindow_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "StockScheduleWindow_businessDate_idx" ON "StockScheduleWindow"("businessDate");
CREATE INDEX "StockScheduleWindow_status_idx" ON "StockScheduleWindow"("status");
