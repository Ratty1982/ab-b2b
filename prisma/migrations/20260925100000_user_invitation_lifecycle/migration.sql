-- Staff invitations + USER_INVITATION purpose + safer User FK deletes.

CREATE TYPE "InvitationKind" AS ENUM ('COMPANY_USER', 'STAFF_USER');

ALTER TYPE "TransactionalEmailPurpose" ADD VALUE 'USER_INVITATION';

ALTER TABLE "UserInvitation" ADD COLUMN "kind" "InvitationKind" NOT NULL DEFAULT 'COMPANY_USER';
ALTER TABLE "UserInvitation" ADD COLUMN "userId" TEXT;
ALTER TABLE "UserInvitation" ADD COLUMN "systemRoleKey" TEXT;

-- Make company portal fields optional so STAFF_USER invites work.
ALTER TABLE "UserInvitation" ALTER COLUMN "companyId" DROP NOT NULL;
ALTER TABLE "UserInvitation" ALTER COLUMN "role" DROP NOT NULL;

CREATE INDEX "UserInvitation_userId_status_idx" ON "UserInvitation"("userId", "status");
CREATE INDEX "UserInvitation_kind_status_idx" ON "UserInvitation"("kind", "status");

ALTER TABLE "UserInvitation"
  ADD CONSTRAINT "UserInvitation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve audit/history attribution without blocking disposable-user hard delete.
ALTER TABLE "AuditEvent" DROP CONSTRAINT IF EXISTS "AuditEvent_actorUserId_fkey";
ALTER TABLE "AuditEvent" DROP CONSTRAINT IF EXISTS "AuditEvent_targetUserId_fkey";
ALTER TABLE "AuditEvent" DROP CONSTRAINT IF EXISTS "AuditEvent_companyId_fkey";
ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TradeApplication" DROP CONSTRAINT IF EXISTS "TradeApplication_reviewedById_fkey";
ALTER TABLE "TradeApplication"
  ADD CONSTRAINT "TradeApplication_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductImportJob" DROP CONSTRAINT IF EXISTS "ProductImportJob_uploadedById_fkey";
ALTER TABLE "ProductImportJob"
  ADD CONSTRAINT "ProductImportJob_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
