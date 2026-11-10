/**
 * Helpers for Customer Setup form hydration vs server refresh.
 * Independent Autopart / history operations must not wipe unsaved edits.
 */

export type CustomerSetupRefreshMode = "full" | "server-only";

/**
 * Decide whether a server refresh should overwrite local form fields.
 * - full: initial load, company switch, or successful save
 * - server-only: Autopart verify / history / background refresh while dirty
 */
export function resolveCustomerSetupRefreshMode(input: {
  dirty: boolean;
  forceHydrate?: boolean;
}): CustomerSetupRefreshMode {
  if (input.forceHydrate) return "full";
  if (input.dirty) return "server-only";
  return "full";
}

export function shouldHydrateFormFields(mode: CustomerSetupRefreshMode): boolean {
  return mode === "full";
}

/** Keep local form value when dirty; otherwise take the server value. */
export function mergePreservedField<T>(dirty: boolean, local: T, server: T): T {
  return dirty ? local : server;
}

export type RequirementProgressTone = "complete" | "action_required" | "in_progress";

export function requirementProgressTone(input: {
  complete: boolean;
  orderingApproved: boolean;
  requirementId: string;
}): RequirementProgressTone {
  if (input.complete) return "complete";
  // Credit review is an explicit staff action on the form.
  if (input.requirementId === "credit_limit_reviewed" && !input.orderingApproved) {
    return "action_required";
  }
  return "action_required";
}

export function requirementProgressLabel(tone: RequirementProgressTone): string {
  switch (tone) {
    case "complete":
      return "Complete";
    case "in_progress":
      return "In progress";
    default:
      return "Action required";
  }
}
