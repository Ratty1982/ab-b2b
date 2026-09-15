-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "targetUserId" TEXT;

-- AlterTable
ALTER TABLE "SalesRep" ADD COLUMN     "managerId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "image" TEXT;

-- CreateTable
CREATE TABLE "AuthVerification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActingContext" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "onBehalfOfCompanyId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActingContext_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthVerification_identifier_idx" ON "AuthVerification"("identifier");

-- CreateIndex
CREATE INDEX "ActingContext_actorUserId_endedAt_idx" ON "ActingContext"("actorUserId", "endedAt");

-- CreateIndex
CREATE INDEX "ActingContext_onBehalfOfCompanyId_idx" ON "ActingContext"("onBehalfOfCompanyId");

-- CreateIndex
CREATE INDEX "AuditEvent_targetUserId_createdAt_idx" ON "AuditEvent"("targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "SalesRep_managerId_idx" ON "SalesRep"("managerId");

-- AddForeignKey
ALTER TABLE "ActingContext" ADD CONSTRAINT "ActingContext_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActingContext" ADD CONSTRAINT "ActingContext_onBehalfOfCompanyId_fkey" FOREIGN KEY ("onBehalfOfCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRep" ADD CONSTRAINT "SalesRep_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "SalesRep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
