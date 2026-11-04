/**
 * Onboarding progress derived from the customer records that already exist.
 * Active status is not treated as proof that every step is finished.
 */
import { companyPriceListLabel } from "@/domain/default-trade-price";
import { historicalSalesStatusLabel } from "@/domain/customer-autopart-workspace";

export type OnboardingStepId =
  | "details"
  | "autopart"
  | "trading"
  | "history"
  | "portal"
  | "activation";

export type OnboardingStepState =
  | "complete"
  | "required"
  | "optional"
  | "awaiting_verification"
  | "blocked";

export type OnboardingTab =
  | "Contacts"
  | "Addresses"
  | "Commercial"
  | "Autopart"
  | "Users"
  | "Orders"
  | "Quotes";

export type OnboardingAction = {
  label: string;
  tab: OnboardingTab | "Overview";
  anchor?: string;
};

export type OnboardingStep = {
  id: OnboardingStepId;
  label: string;
  state: OnboardingStepState;
  summary: string;
  action: OnboardingAction | null;
};

export type OnboardingReadiness = "blocked" | "action_required" | "awaiting_verification" | "ready";

export type CustomerOnboardingInput = {
  status: string;
  contactCount: number;
  addressCount: number;
  salesCode: string | null;
  /** True only when a verification timestamp is stored and ownership is unambiguous. */
  salesCodeVerified: boolean;
  /** Saved code whose ownership conflicts with another customer. */
  ownershipAmbiguous: boolean;
  ownershipNote: string | null;
  masterLinked: boolean;
  /** Empty when the viewer may not see master account codes. */
  masterCodes: string[];
  masterRestricted: boolean;
  priceListName: string | null;
  paymentTerms: string | null;
  customerGroupName: string | null;
  taxStatus: string;
  historyStatus: "NOT_STARTED" | "REVIEW" | "COMPLETE";
  historyKind: string | null;
  portalActiveUsers: number;
  portalPending: number;
  canEditCompany: boolean;
  canEditContacts: boolean;
  canManageUsers: boolean;
  canImportHistory: boolean;
};

export type CustomerOnboarding = {
  /** Company.status is ACTIVE. Other steps may still be open. */
  activationComplete: boolean;
  /** No blocked, required, or awaiting-verification step remains. */
  onboardingComplete: boolean;
  readiness: OnboardingReadiness;
  readinessLabel: string;
  steps: OnboardingStep[];
  next: OnboardingStep | null;
  optional: OnboardingStep[];
};

const STEP_LABEL: Record<OnboardingStepId, string> = {
  details: "Customer details",
  autopart: "Autopart account",
  trading: "Pricing and trading terms",
  history: "Historical sales",
  portal: "Portal access",
  activation: "Account status",
};

function step(
  id: OnboardingStepId,
  state: OnboardingStepState,
  summary: string,
  action: OnboardingAction | null,
): OnboardingStep {
  return { id, label: STEP_LABEL[id], state, summary, action };
}

function salesCodeKey(code: string): string {
  return code.trim().toUpperCase();
}

function historySummary(input: CustomerOnboardingInput): string {
  const label = historicalSalesStatusLabel({
    historyStatus: input.historyStatus,
    historyKind: input.historyKind,
  });
  if (input.historyStatus === "COMPLETE" && input.historyKind === "NO_HISTORICAL_SALES") {
    return `${label}. This is a confirmed zero-history cutover. It is not a discarded pre-launch history.`;
  }
  if (input.historyStatus === "COMPLETE" && input.historyKind === "PRELAUNCH_HISTORY_DISCARDED") {
    return `${label}. Previously imported history was deliberately discarded. This is not a claim that the customer never bought.`;
  }
  if (input.historyStatus === "COMPLETE") return label;
  if (input.historyStatus === "REVIEW") {
    return "Import exceptions are waiting for review. This is not a zero-history decision.";
  }
  return "Historical sales are not decided. A new customer with no purchases does not need a blank spreadsheet.";
}

function autopartSummary(input: CustomerOnboardingInput): string {
  const master = input.masterLinked
    ? input.masterRestricted || input.masterCodes.length === 0
      ? "407EXP master is linked."
      : `407EXP master ${input.masterCodes.join(", ")} is linked.`
    : "407EXP master is not linked.";
  if (input.ownershipAmbiguous) {
    return `${input.ownershipNote ?? "This sales account is also connected to another customer."} ${master}`;
  }
  if (input.salesCode && input.salesCodeVerified) {
    const sameMaster =
      input.masterCodes.length > 0 &&
      input.masterCodes.every((code) => salesCodeKey(code) === salesCodeKey(input.salesCode!));
    const differs =
      input.masterLinked &&
      input.masterCodes.length > 0 &&
      !input.masterCodes.some((code) => salesCodeKey(code) === salesCodeKey(input.salesCode!));
    const relation = differs
      ? " The master account is a different identifier from the verified sales code."
      : sameMaster
        ? " The master account matches the verified sales code."
        : "";
    return `Verified sales account ${input.salesCode}. ${master}${relation}`;
  }
  if (input.salesCode) {
    return `Sales account ${input.salesCode} is saved and has not been verified. ${master}`;
  }
  return `No sales account is saved. ${master} Linking the master list does not verify a sales account.`;
}

export function deriveCustomerOnboarding(input: CustomerOnboardingInput): CustomerOnboarding {
  const tradingHeld = input.status === "ON_HOLD" || input.status === "SUSPENDED" || input.status === "CLOSED";
  const active = input.status === "ACTIVE";
  const activationComplete = active;

  const details = step(
    "details",
    "complete",
    input.contactCount > 0 || input.addressCount > 0
      ? "Legal name is recorded."
      : "Legal name is recorded. A contact and address can be added later.",
    null,
  );

  const autopart = input.ownershipAmbiguous
    ? step(
        "autopart",
        "blocked",
        autopartSummary(input),
        input.canEditCompany ? { label: "Review the sales account", tab: "Commercial" } : null,
      )
    : input.salesCode && !input.salesCodeVerified
      ? step(
          "autopart",
          "awaiting_verification",
          autopartSummary(input),
          input.canEditCompany ? { label: "Verify the sales account", tab: "Commercial" } : null,
        )
      : input.salesCodeVerified
        ? step("autopart", "complete", autopartSummary(input), null)
        : step("autopart", "optional", autopartSummary(input), input.canEditCompany
            ? { label: "Link an Autopart account", tab: "Commercial" }
            : null);

  const priceLabel = companyPriceListLabel(input.priceListName);
  const trading = step(
    "trading",
    "complete",
    `${priceLabel}. Payment terms ${input.paymentTerms?.trim() || "not set"}. Customer group ${
      input.customerGroupName?.trim() || "not set"
    }. Tax ${input.taxStatus}. Credit balance is not stored in Automotive Brands.`,
    null,
  );

  let history: OnboardingStep;
  if (!input.salesCodeVerified || input.ownershipAmbiguous) {
    history = step("history", "optional", "Historical sales wait until the sales account is verified.", null);
  } else if (input.historyStatus === "REVIEW") {
    history = step(
      "history",
      "blocked",
      historySummary(input),
      input.canImportHistory ? { label: "Review import exceptions", tab: "Autopart" } : null,
    );
  } else if (input.historyStatus === "NOT_STARTED" && active) {
    history = step(
      "history",
      "required",
      historySummary(input),
      input.canImportHistory ? { label: "Open sales history", tab: "Autopart" } : null,
    );
  } else if (input.historyStatus === "COMPLETE") {
    history = step("history", "complete", historySummary(input), null);
  } else {
    history = step(
      "history",
      "optional",
      "Historical sales are decided after the account is active.",
      null,
    );
  }

  let portal: OnboardingStep;
  if (!active) {
    portal = step("portal", "optional", "Portal login is available after the account is active.", null);
  } else if (input.portalActiveUsers > 0) {
    portal = step(
      "portal",
      "complete",
      input.portalPending > 0
        ? `${input.portalActiveUsers} portal user${input.portalActiveUsers === 1 ? "" : "s"} can sign in. Another invitation is still pending.`
        : `${input.portalActiveUsers} portal user${input.portalActiveUsers === 1 ? "" : "s"} can sign in.`,
      input.canManageUsers ? { label: "Review portal users", tab: "Users" } : null,
    );
  } else if (input.portalPending > 0) {
    portal = step(
      "portal",
      "awaiting_verification",
      "A portal invitation is pending. The person cannot sign in until they activate it.",
      input.canManageUsers ? { label: "Review invitations", tab: "Users" } : null,
    );
  } else {
    portal = step(
      "portal",
      "optional",
      "No portal user yet. Trading does not require a login.",
      input.canManageUsers ? { label: "Invite a portal user", tab: "Users" } : null,
    );
  }

  const activation = tradingHeld
    ? step(
        "activation",
        "blocked",
        input.status === "CLOSED"
          ? "This account is closed."
          : input.status === "SUSPENDED"
            ? "This account is suspended. Portal trading is blocked."
            : "This account is on hold. Portal trading is blocked.",
        input.canEditCompany
          ? { label: "Review account status", tab: "Overview", anchor: "customer-status" }
          : null,
      )
    : active
      ? step(
          "activation",
          "complete",
          "This account is active. Active status does not complete Autopart, history, pricing, or portal setup.",
          null,
        )
      : step(
          "activation",
          "required",
          "This account is not approved for trading yet. Activation does not verify an Autopart code or record sales history.",
          input.canEditCompany
          ? { label: "Review account status", tab: "Overview", anchor: "customer-status" }
          : null,
        );

  const steps = [details, autopart, trading, history, portal, activation];
  const priority: Array<{ id?: OnboardingStepId; state: OnboardingStepState }> = [
    { state: "blocked" },
    { id: "autopart", state: "awaiting_verification" },
    { id: "history", state: "required" },
    { id: "activation", state: "required" },
    { id: "portal", state: "awaiting_verification" },
    { state: "required" },
    { state: "awaiting_verification" },
  ];
  let next: OnboardingStep | null = null;
  for (const rule of priority) {
    next = steps.find((item) => item.state === rule.state && (rule.id == null || item.id === rule.id)) ?? null;
    if (next) break;
  }
  const optional: OnboardingStep[] = [];
  if (input.contactCount === 0) {
    optional.push(
      step(
        "details",
        "optional",
        "No contact is recorded.",
        input.canEditContacts ? { label: "Add a contact", tab: "Contacts" } : null,
      ),
    );
  }
  if (input.addressCount === 0) {
    optional.push(
      step(
        "details",
        "optional",
        "No address is recorded.",
        input.canEditCompany ? { label: "Add an address", tab: "Addresses" } : null,
      ),
    );
  }
  if (!input.paymentTerms?.trim()) {
    optional.push(
      step(
        "trading",
        "optional",
        "Payment terms are not set.",
        input.canEditCompany ? { label: "Edit trading terms", tab: "Commercial" } : null,
      ),
    );
  }

  const readiness: OnboardingReadiness = next
    ? next.state === "blocked"
      ? "blocked"
      : next.state === "awaiting_verification"
        ? "awaiting_verification"
        : "action_required"
    : "ready";
  const readinessLabel =
    readiness === "blocked"
      ? "Operational blocker"
      : readiness === "action_required"
        ? "Required action"
        : readiness === "awaiting_verification"
          ? "Awaiting verification"
          : "No required actions";

  return {
    activationComplete,
    onboardingComplete: readiness === "ready",
    readiness,
    readinessLabel,
    steps,
    next,
    optional,
  };
}
