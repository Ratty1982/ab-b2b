import { COMPANY_STATUS_LABEL, type CompanyStatusKey } from "@/domain/company";

export type CompanyStatusAction = {
  nextStatus: CompanyStatusKey;
  label: string;
  confirmTitle: string;
  confirmBody: string;
  tone: "primary" | "warn" | "danger";
};

const PORTAL_PAUSE =
  "Portal memberships for this customer are disabled and pending invitations are revoked. Sales history, orders, and invoices stay as they are. Nobody is invited and ordering permissions are not granted.";

export function companyOverviewStatusActions(status: CompanyStatusKey): CompanyStatusAction[] {
  switch (status) {
    case "PROSPECT":
    case "PENDING_APPROVAL":
      return [
        {
          nextStatus: "ACTIVE",
          label: "Activate Account",
          confirmTitle: "Activate this account?",
          confirmBody:
            "The customer becomes Active. This does not invite portal users, import sales history, or turn on ordering by itself.",
          tone: "primary",
        },
      ];
    case "ACTIVE":
      return [
        {
          nextStatus: "ON_HOLD",
          label: "Put on hold",
          confirmTitle: "Put this account on hold?",
          confirmBody: PORTAL_PAUSE,
          tone: "warn",
        },
        {
          nextStatus: "SUSPENDED",
          label: "Suspend",
          confirmTitle: "Suspend this account?",
          confirmBody: PORTAL_PAUSE,
          tone: "warn",
        },
        {
          nextStatus: "CLOSED",
          label: "Close account",
          confirmTitle: "Close this account?",
          confirmBody: PORTAL_PAUSE,
          tone: "danger",
        },
      ];
    case "ON_HOLD":
      return [
        {
          nextStatus: "ACTIVE",
          label: "Reactivate",
          confirmTitle: "Reactivate this account?",
          confirmBody:
            "The customer becomes Active again. Portal users are not invited automatically and suspended memberships are not restored.",
          tone: "primary",
        },
        {
          nextStatus: "SUSPENDED",
          label: "Suspend",
          confirmTitle: "Suspend this account?",
          confirmBody: PORTAL_PAUSE,
          tone: "warn",
        },
        {
          nextStatus: "CLOSED",
          label: "Close account",
          confirmTitle: "Close this account?",
          confirmBody: PORTAL_PAUSE,
          tone: "danger",
        },
      ];
    case "SUSPENDED":
      return [
        {
          nextStatus: "ACTIVE",
          label: "Reactivate",
          confirmTitle: "Reactivate this account?",
          confirmBody:
            "The customer becomes Active again. Portal users are not invited automatically and suspended memberships are not restored.",
          tone: "primary",
        },
        {
          nextStatus: "ON_HOLD",
          label: "Put on hold",
          confirmTitle: "Put this account on hold?",
          confirmBody: "The account stays closed to new portal use. Existing memberships are not re-enabled.",
          tone: "warn",
        },
        {
          nextStatus: "CLOSED",
          label: "Close account",
          confirmTitle: "Close this account?",
          confirmBody: PORTAL_PAUSE,
          tone: "danger",
        },
      ];
    case "CLOSED":
      return [
        {
          nextStatus: "ACTIVE",
          label: "Reopen account",
          confirmTitle: "Reopen this account?",
          confirmBody:
            "The customer becomes Active again. Portal users are not invited automatically and closed memberships are not restored.",
          tone: "primary",
        },
      ];
    default:
      return [];
  }
}

export function companyActivationWarnings(input: {
  autopartVerified: boolean;
  autopartCode: string | null;
  paymentTerms: string | null;
  priceListName: string | null;
  salespersonName: string | null;
}): string[] {
  const warnings: string[] = [];
  if (!input.autopartCode) {
    warnings.push("No Autopart account is assigned. Activation does not create or verify one.");
  } else if (!input.autopartVerified) {
    warnings.push(
      `Autopart account ${input.autopartCode} is not verified. Activation does not verify it.`,
    );
  }
  if (!input.paymentTerms?.trim()) {
    warnings.push("Payment terms are not set. Activation does not fill commercial settings.");
  }
  if (!input.priceListName) {
    warnings.push("No price list is assigned. The customer keeps the default trade price.");
  }
  if (!input.salespersonName) {
    warnings.push("No salesperson is assigned. Activation does not assign one.");
  }
  return warnings;
}

export function companyStatusLabel(status: string): string {
  if (status in COMPANY_STATUS_LABEL) {
    return COMPANY_STATUS_LABEL[status as CompanyStatusKey];
  }
  return status;
}
