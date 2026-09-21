-- Keep the original import file off the preview JSON column.

ALTER TABLE "ProductImportJob" ADD COLUMN "sourceCsv" TEXT;
