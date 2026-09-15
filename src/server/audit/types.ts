/**
 * Security-sensitive audit actions recorded in Phase 1.
 * Never store passwords, session tokens, reset tokens, or secrets in metadata.
 */
export const AUDIT_ACTIONS = [
  "LOGIN_SUCCESS",
  "LOGIN_FAILED",
  "LOGOUT",
  "PASSWORD_RESET_REQUESTED",
  "PASSWORD_RESET_COMPLETED",
  "ROLE_ASSIGNED",
  "ROLE_REMOVED",
  "COMPANY_ACCESS_GRANTED",
  "COMPANY_ACCESS_REVOKED",
  "ACTING_CONTEXT_STARTED",
  "ACTING_CONTEXT_ENDED",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEventInput {
  action: AuditAction | string;
  entityType: string;
  entityId?: string | null;
  actorUserId?: string | null;
  targetUserId?: string | null;
  companyId?: string | null;
  metadata?: Record<string, unknown> | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
}
