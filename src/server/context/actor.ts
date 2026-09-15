/**
 * Placeholder request context for Phase 1 auth/RBAC.
 * Routes still use prototype localStorage session until Phase 1.
 */
export type ActorKind = "anonymous" | "trade_user" | "internal_user";

export interface RequestActor {
  kind: ActorKind;
  userId?: string;
  email?: string;
  /** Active trade company when acting in a B2B context */
  companyId?: string;
  /** Sales impersonation / order-on-behalf */
  onBehalfOfCompanyId?: string;
  roles: string[];
  permissions: string[];
}

export const anonymousActor: RequestActor = {
  kind: "anonymous",
  roles: [],
  permissions: [],
};

/**
 * Phase 0 stub — always anonymous until Better Auth sessions land in Phase 1.
 */
export function getRequestActor(): RequestActor {
  return anonymousActor;
}
