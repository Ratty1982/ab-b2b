-- Sales Intelligence → CRM follow-up: additive Task source-context fields.
ALTER TABLE "Task" ADD COLUMN "sourceModule" TEXT;
ALTER TABLE "Task" ADD COLUMN "sourceReason" TEXT;
ALTER TABLE "Task" ADD COLUMN "sourceSku" TEXT;
ALTER TABLE "Task" ADD COLUMN "productId" TEXT;
ALTER TABLE "Task" ADD COLUMN "sourceContext" JSONB;

CREATE INDEX "Task_companyId_sourceModule_sourceReason_sourceSku_status_idx"
  ON "Task"("companyId", "sourceModule", "sourceReason", "sourceSku", "status");
CREATE INDEX "Task_sourceModule_status_idx" ON "Task"("sourceModule", "status");
CREATE INDEX "Task_productId_idx" ON "Task"("productId");

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
