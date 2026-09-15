/**
 * Placeholder request context for Phase 1 auth/RBAC.
 * Prefer loadAccessProfile / require* helpers for authoritative checks.
 */
export type ActorKind = "anonymous" | "trade_user" | "internal_user";

export interface RequestActor {
  kind: ActorKind;
  userId?: string;
  email?: string;
  /** Active trade company when acting in a B2B context */
  companyId?: string;
  /** Sales order-on-behalf company (actor remains themselves) */
  onBehalfOfCompanyId?: string;
  roles: string[];
  permissions: string[];
}

export const anonymousActor: RequestActor = {
  kind: "anonymous",
  roles: [],
  permissions: [],
};
