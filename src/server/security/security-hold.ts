/**
 * Administrator security suspension.
 *
 * This is not the 15-minute password pause, and it is not User.status DISABLED.
 * Five unauthenticated password failures must never call these helpers.
 * Applying a hold does not change company, price, or order records.
 */

export type SecurityHoldRefusal = "missing-account" | "self" | "last-administrator";

export function securityHoldRefusal(input: {
  actorUserId: string;
  targetUserId: string;
  targetFound: boolean;
  lastEffectiveSuperAdmin: boolean;
}): SecurityHoldRefusal | null {
  if (input.actorUserId === input.targetUserId) return "self";
  if (!input.targetFound) return "missing-account";
  if (input.lastEffectiveSuperAdmin) return "last-administrator";
  return null;
}

export function appliedSecurityHold(input: { actorUserId: string; reason: string; at: Date }): {
  active: true;
  reason: string;
  appliedByUserId: string;
  appliedAt: Date;
  releasedByUserId: null;
  releasedAt: null;
} {
  return {
    active: true,
    reason: input.reason.trim().slice(0, 300),
    appliedByUserId: input.actorUserId,
    appliedAt: input.at,
    releasedByUserId: null,
    releasedAt: null,
  };
}

export function releasedSecurityHold(input: { actorUserId: string; at: Date }): {
  active: false;
  releasedByUserId: string;
  releasedAt: Date;
} {
  return {
    active: false,
    releasedByUserId: input.actorUserId,
    releasedAt: input.at,
  };
}

export function securityHoldRefusalMessage(refusal: SecurityHoldRefusal): string {
  if (refusal === "self") return "You cannot place a security hold on your own account";
  if (refusal === "last-administrator") {
    return "Cannot suspend the last effective administrator";
  }
  return "User not found";
}
