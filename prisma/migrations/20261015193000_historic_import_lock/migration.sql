-- One historical ALL import at a time. A restarted container can recover a stale lock.
-- No sales rows are changed.

ALTER TABLE "AutopartHistoryAllImport" ADD COLUMN "lockOwner" TEXT;
ALTER TABLE "AutopartHistoryAllImport" ADD COLUMN "heartbeatAt" TIMESTAMP(3);
