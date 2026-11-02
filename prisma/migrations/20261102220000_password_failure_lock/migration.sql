-- Shared confirmed-password failure counter and a separate administrator security hold.
-- Neither table changes User.status.

CREATE TABLE IF NOT EXISTS "AuthPasswordFailure" (
    "accountKey" TEXT NOT NULL,
    "failureCount" INTEGER NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AuthPasswordFailure_pkey" PRIMARY KEY ("accountKey")
);

CREATE TABLE IF NOT EXISTS "UserSecurityHold" (
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "appliedByUserId" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedByUserId" TEXT,
    "releasedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserSecurityHold_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX IF NOT EXISTS "UserSecurityHold_active_idx" ON "UserSecurityHold"("active");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserSecurityHold_userId_fkey'
  ) THEN
    ALTER TABLE "UserSecurityHold"
      ADD CONSTRAINT "UserSecurityHold_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
