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

export type ZeroQuotationSendItem = {
  sku: string;
  customerUnitPrice: string | number | null | undefined;
  priceOverride?: boolean | null;
  zeroValueReasonCode?: string | null;
  zeroValueReasonDetail?: string | null;
};

/**
 * An entirely £0.00 quotation can be sent when every line has a valid reason.
 * An overridden zero price still needs quote price-override permission.
 * A positive quotation whose goods or grand total is not positive stays blocked.
 */
export function assessZeroQuotationSend(input: {
  items: ZeroQuotationSendItem[];
  goodsArePositive: boolean;
  grandIsPositive: boolean;
  canOverridePrice: boolean;
}):
  | {
      ok: true;
      zeroLines: Array<{ sku: string; zeroValueReasonCode: string; zeroValueReasonDetail: string | null }>;
    }
  | { ok: false; code: "VALIDATION" | "ZERO_VALUE_REASON_REQUIRED" | "FORBIDDEN"; message: string } {
  if (input.items.length === 0) {
    return {
      ok: false,
      code: "VALIDATION",
      message: "Add at least one valid product before sending this quotation.",
    };
  }
  const zeroLines: Array<{ sku: string; zeroValueReasonCode: string; zeroValueReasonDetail: string | null }> = [];
  for (const item of input.items) {
    if (!isZeroSellingPrice(item.customerUnitPrice)) continue;
    const reason = zeroValueReasonForPrice({
      customerUnitPrice: item.customerUnitPrice,
      code: item.zeroValueReasonCode,
      detail: item.zeroValueReasonDetail,
    });
    if (!reason.ok) {
      return {
        ok: false,
        code: "ZERO_VALUE_REASON_REQUIRED",
        message: `${item.sku}: ${reason.message}`,
      };
    }
    if (item.priceOverride && !input.canOverridePrice) {
      return { ok: false, code: "FORBIDDEN", message: "Quote price override not permitted" };
    }
    if (!reason.code) {
      return {
        ok: false,
        code: "ZERO_VALUE_REASON_REQUIRED",
        message: `${item.sku}: Choose a reason for the £0.00 selling price.`,
      };
    }
    zeroLines.push({
      sku: item.sku,
      zeroValueReasonCode: reason.code,
      zeroValueReasonDetail: reason.detail,
    });
  }
  const entirelyZero = zeroLines.length === input.items.length;
  if (!entirelyZero && (!input.goodsArePositive || !input.grandIsPositive)) {
    return {
      ok: false,
      code: "VALIDATION",
      message: "Add at least one valid product before sending this quotation.",
    };
  }
  return { ok: true, zeroLines };
}

export function zeroValueAuditLines(
  items: Array<{
    sku: string;
    qty?: number | null | undefined;
    customerUnitPrice: string | number | { toString(): string } | null | undefined;
    zeroValueReasonCode?: string | null | undefined;
    zeroValueReasonDetail?: string | null | undefined;
  }>,
) {
  return items.flatMap((item) => {
    const price = item.customerUnitPrice == null ? null : String(item.customerUnitPrice);
    if (!isZeroSellingPrice(price)) return [];
    return [
      {
        sku: item.sku,
        qty: item.qty ?? null,
        zeroValueReasonCode: item.zeroValueReasonCode ?? null,
        zeroValueReasonDetail: item.zeroValueReasonDetail ?? null,
      },
    ];
  });
}
