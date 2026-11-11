/**
 * A line supplied at a £0.00 selling price needs a reason.
 * A positive unit price does not, even if another credit makes a document total zero.
 * The reason does not grant permission to override a price.
 */

export const ZERO_VALUE_REASONS = [
  { code: "GOODWILL", label: "Goodwill replacement" },
  { code: "WARRANTY", label: "Warranty replacement" },
  { code: "DAMAGED", label: "Damaged goods replacement" },
  { code: "SAMPLE", label: "Promotional sample" },
  { code: "AGREEMENT", label: "Commercial agreement" },
  { code: "OTHER", label: "Other" },
] as const;

export type ZeroValueReasonCode = (typeof ZERO_VALUE_REASONS)[number]["code"];

const CODES = new Set<string>(ZERO_VALUE_REASONS.map((reason) => reason.code));

export function isZeroSellingPrice(customerUnitPrice: string | number | null | undefined): boolean {
  if (customerUnitPrice == null || customerUnitPrice === "") return false;
  const amount = Number(customerUnitPrice);
  return Number.isFinite(amount) && amount === 0;
}

export function zeroValueReasonForPrice(input: {
  customerUnitPrice: string | number | null | undefined;
  code?: string | null | undefined;
  detail?: string | null | undefined;
}):
  | { ok: true; code: string | null; detail: string | null }
  | { ok: false; message: string } {
  if (!isZeroSellingPrice(input.customerUnitPrice)) {
    return { ok: true, code: null, detail: null };
  }
  const code = input.code?.trim() ?? "";
  if (!CODES.has(code)) {
    return { ok: false, message: "Choose a reason for the £0.00 selling price." };
  }
  const detail = input.detail?.trim() ?? "";
  if (detail.length > 500) {
    return { ok: false, message: "Keep the explanation to 500 characters." };
  }
  if (code === "OTHER" && detail.length < 3) {
    return {
      ok: false,
      message: "Enter the specific reason for this £0.00 selling price.",
    };
  }
  return { ok: true, code, detail: detail || null };
}

export function zeroValueReasonLabel(code: string | null | undefined): string | null {
  return ZERO_VALUE_REASONS.find((reason) => reason.code === code)?.label ?? null;
}
