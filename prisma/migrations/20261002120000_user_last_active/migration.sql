-- Lightweight presence metadata for Super Admin staff activity (UTC).
-- Not an audit/clickstream table — only User.lastActiveAt is updated (throttled).

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastActiveAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "User_lastLoginAt_idx" ON "User"("lastLoginAt");
CREATE INDEX IF NOT EXISTS "User_lastActiveAt_idx" ON "User"("lastActiveAt");
