-- CreateEnum
CREATE TYPE "AutopartProspectConversionStatus" AS ENUM ('PREVIEWED', 'RUNNING', 'COMMITTED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "AutopartProspectConversionRun" (
    "id" TEXT NOT NULL,
    "status" "AutopartProspectConversionStatus" NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "summary" JSONB NOT NULL,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "createdProspects" INTEGER NOT NULL DEFAULT 0,
    "reusedCompanies" INTEGER NOT NULL DEFAULT 0,
    "skippedLinked" INTEGER NOT NULL DEFAULT 0,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "cursorAccountId" TEXT,
    "errorSummary" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopartProspectConversionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopartProspectConversionIssue" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "accountCode" TEXT,
    "issueType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutopartProspectConversionIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutopartProspectConversionRun_status_heartbeatAt_idx" ON "AutopartProspectConversionRun"("status", "heartbeatAt");

-- CreateIndex
CREATE INDEX "AutopartProspectConversionRun_createdAt_idx" ON "AutopartProspectConversionRun"("createdAt");

-- CreateIndex
CREATE INDEX "AutopartProspectConversionIssue_runId_issueType_idx" ON "AutopartProspectConversionIssue"("runId", "issueType");

-- CreateIndex
CREATE INDEX "AutopartProspectConversionIssue_accountCode_idx" ON "AutopartProspectConversionIssue"("accountCode");

-- CreateIndex
CREATE INDEX "AutopartAccount_classification_companyId_id_idx" ON "AutopartAccount"("classification", "companyId", "id");

-- AddForeignKey
ALTER TABLE "AutopartProspectConversionRun" ADD CONSTRAINT "AutopartProspectConversionRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopartProspectConversionIssue" ADD CONSTRAINT "AutopartProspectConversionIssue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AutopartProspectConversionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
