/**
 * Staff-facing Autopart workspace state.
 * Stages come from stored customer, cutover, and import records.
 */

export type AutopartStageState = "COMPLETE" | "ACTION_REQUIRED" | "UNDER_REVIEW" | "NOT_STARTED";

export type AutopartStageId = "verify" | "history" | "exceptions" | "current" | "enquiry";

export type AutopartPrimaryAction =
  | "verify"
  | "activate"
  | "import-history"
  | "review-exceptions"
  | "import-current"
  | "view-enquiry";

export type CustomerAutopartStageInput = {
  companyStatus: string;
  verified: boolean;
  hasAccountCode: boolean;
  ownershipAmbiguous: boolean;
  historyStatus: "NOT_STARTED" | "REVIEW" | "COMPLETE";
  ongoingImportCount: number;
};

export type CustomerAutopartStage = {
  id: AutopartStageId;
  label: string;
  state: AutopartStageState;
};

const STAGE_LABEL: Record<AutopartStageId, string> = {
  verify: "Verify the Autopart account",
  history: "Establish historical sales",
  exceptions: "Resolve import exceptions",
  current: "Import current sales",
  enquiry: "View Sales Enquiry",
};

export function customerAutopartStages(input: CustomerAutopartStageInput): CustomerAutopartStage[] {
  const verify: AutopartStageState = input.ownershipAmbiguous
    ? "UNDER_REVIEW"
    : input.verified
      ? "COMPLETE"
      : input.hasAccountCode
        ? "UNDER_REVIEW"
        : "ACTION_REQUIRED";

  const history: AutopartStageState = !input.verified
    ? "NOT_STARTED"
    : input.historyStatus === "COMPLETE"
      ? "COMPLETE"
      : input.historyStatus === "REVIEW"
        ? "UNDER_REVIEW"
        : input.companyStatus === "ACTIVE"
          ? "ACTION_REQUIRED"
          : "NOT_STARTED";

  const exceptions: AutopartStageState =
    input.historyStatus === "REVIEW"
      ? "ACTION_REQUIRED"
      : input.historyStatus === "COMPLETE"
        ? "COMPLETE"
        : "NOT_STARTED";

  const current: AutopartStageState =
    input.historyStatus !== "COMPLETE" || input.companyStatus !== "ACTIVE"
      ? "NOT_STARTED"
      : input.ongoingImportCount > 0
        ? "COMPLETE"
        : "ACTION_REQUIRED";

  const enquiry: AutopartStageState =
    input.historyStatus === "COMPLETE" || input.ongoingImportCount > 0 ? "COMPLETE" : "NOT_STARTED";

  const states: Record<AutopartStageId, AutopartStageState> = {
    verify,
    history,
    exceptions,
    current,
    enquiry,
  };
  return (Object.keys(STAGE_LABEL) as AutopartStageId[]).map((id) => ({
    id,
    label: STAGE_LABEL[id],
    state: states[id],
  }));
}

export function customerAutopartPrimaryAction(input: CustomerAutopartStageInput): AutopartPrimaryAction {
  if (input.ownershipAmbiguous || !input.verified) return "verify";
  if (input.companyStatus !== "ACTIVE") return "activate";
  if (input.historyStatus === "REVIEW") return "review-exceptions";
  if (input.historyStatus === "NOT_STARTED") return "import-history";
  if (input.ongoingImportCount === 0) return "import-current";
  return "view-enquiry";
}

export function autopartStageStateLabel(state: AutopartStageState): string {
  switch (state) {
    case "COMPLETE":
      return "Complete";
    case "ACTION_REQUIRED":
      return "Action required";
    case "UNDER_REVIEW":
      return "Under review";
    case "NOT_STARTED":
      return "Not started";
  }
}

export function autopartPrimaryActionLabel(action: AutopartPrimaryAction): string {
  switch (action) {
    case "verify":
      return "Verify account";
    case "activate":
      return "Activate customer";
    case "import-history":
      return "Import sales history";
    case "review-exceptions":
      return "Review exceptions";
    case "import-current":
      return "Import current sales";
    case "view-enquiry":
      return "View Sales Enquiry";
  }
}

export function historicalSalesStatusLabel(input: {
  historyStatus: "NOT_STARTED" | "REVIEW" | "COMPLETE";
  historyKind: string | null;
}): string {
  if (input.historyStatus === "REVIEW") return "Exceptions to review";
  if (input.historyStatus !== "COMPLETE") return "Not started";
  if (input.historyKind === "NO_HISTORICAL_SALES") return "No historical purchases";
  if (input.historyKind === "PRELAUNCH_HISTORY_DISCARDED") return "New sales baseline";
  return "History imported";
}
