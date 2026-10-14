/**
 * Confirmation rules for archiving test orders.
 * Archiving is separate from permanent deletion and does not use deletion blockers.
 */

const REASON_MAX = 500;
const BULK_MAX = 50;

export type ArchiveTestOrderConfirmation =
  | { ok: true; reason: string; orderNumbers: string[] }
  | {
      ok: false;
      code:
        | "REASON_REQUIRED"
        | "REASON_TOO_LONG"
        | "TEST_DATA_CONFIRMATION_REQUIRED"
        | "ORDER_NUMBER_MISMATCH"
        | "TOO_MANY_ORDERS";
      message: string;
    };

export function canOfferArchiveTestOrder(input: {
  systemRoles: readonly string[];
  archivedAt: string | null;
}): boolean {
  return input.systemRoles.includes("SUPER_ADMIN") && input.archivedAt == null;
}

export function canOfferRestoreTestOrder(input: {
  systemRoles: readonly string[];
  archivedAt: string | null;
}): boolean {
  return input.systemRoles.includes("SUPER_ADMIN") && input.archivedAt != null;
}

function splitOrderNumbers(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function validateArchiveTestOrdersConfirmation(input: {
  reason: unknown;
  confirmTestData: unknown;
  confirmOrderNumbers: unknown;
  expectedOrderNumbers: readonly string[];
}): ArchiveTestOrderConfirmation {
  if (input.expectedOrderNumbers.length === 0) {
    return {
      ok: false,
      code: "ORDER_NUMBER_MISMATCH",
      message: "Select at least one test order to archive.",
    };
  }
  if (input.expectedOrderNumbers.length > BULK_MAX) {
    return {
      ok: false,
      code: "TOO_MANY_ORDERS",
      message: "Archive at most 50 test orders at a time.",
    };
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) {
    return {
      ok: false,
      code: "REASON_REQUIRED",
      message: "Enter a reason for archiving this test order.",
    };
  }
  if (reason.length > REASON_MAX) {
    return {
      ok: false,
      code: "REASON_TOO_LONG",
      message: "The archive reason must be 500 characters or fewer.",
    };
  }
  if (input.confirmTestData !== true) {
    return {
      ok: false,
      code: "TEST_DATA_CONFIRMATION_REQUIRED",
      message: "Confirm that these orders are test data.",
    };
  }
  const expected = [...input.expectedOrderNumbers].sort();
  const typed = [...splitOrderNumbers(input.confirmOrderNumbers)].sort();
  const same =
    expected.length === typed.length && expected.every((orderNumber, index) => orderNumber === typed[index]);
  if (!same) {
    return {
      ok: false,
      code: "ORDER_NUMBER_MISMATCH",
      message:
        expected.length === 1
          ? "Type the exact order number to confirm archiving."
          : "Type every selected order number to confirm archiving.",
    };
  }
  return { ok: true, reason, orderNumbers: expected };
}

export function validateRestoreTestOrderConfirmation(input: {
  confirmOrderNumber: unknown;
  expectedOrderNumber: string;
}): { ok: true } | { ok: false; code: "ORDER_NUMBER_MISMATCH"; message: string } {
  if (input.confirmOrderNumber !== input.expectedOrderNumber) {
    return {
      ok: false,
      code: "ORDER_NUMBER_MISMATCH",
      message: "Type the exact order number to confirm restore.",
    };
  }
  return { ok: true };
}
