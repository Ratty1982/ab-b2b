/**
 * Sales order entry — staff draft input.
 * Stock, VAT, delivery, and customer list prices are resolved on the server.
 * A staff unit-price override is validated here and applies to this order only.
 */

import { z } from "zod";
import {
  deliveryAddressSnapshotSchema,
  expectedLinePriceSchema,
  type ContactSnapshot,
} from "@/domain/checkout";
import { moneyToString, parseMoney } from "@/domain/money";

export const SALES_ORDER_ENTRY_SOURCES = ["TELEPHONE", "EMAIL", "CUSTOMER_VISIT"] as const;
export type SalesOrderEntrySource = (typeof SALES_ORDER_ENTRY_SOURCES)[number];

export const SALES_ORDER_SOURCE_LABEL: Record<SalesOrderEntrySource, string> = {
  TELEPHONE: "Telephone",
  EMAIL: "Email",
  CUSTOMER_VISIT: "Customer visit",
};

const optionalPlain = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value == null) return null;
      const cleaned = value.replace(/<[^>]*>/g, "").trim();
      return cleaned.length > 0 ? cleaned : null;
    });

/** GBP ex VAT, two decimal places. Rejects negative, blank, and non-finite text. */
export function parseStaffOrderUnitPrice(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const money = parseMoney(trimmed);
  const max = parseMoney("9999999999.99");
  if (!money || !max || money.minor < 0n || money.minor > max.minor) return null;
  return moneyToString(money, 2);
}

export function parseStaffOrderQuantity(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const qty = Number(raw);
  if (!Number.isInteger(qty) || qty < 1 || qty > 99999) return null;
  return qty;
}

export const ORDER_FULFILMENT_CHOICES = ["DELIVERY", "COLLECTION"] as const;
export type OrderFulfilmentChoice = (typeof ORDER_FULFILMENT_CHOICES)[number];

export const ORDER_FULFILMENT_LABEL: Record<OrderFulfilmentChoice, string> = {
  DELIVERY: "Delivery",
  COLLECTION: "Customer Collection",
};

export type SalesOrderDraftLineInput = {
  variantId: string;
  /** Null until staff type a quantity. Never defaulted to a case or minimum. */
  qty: number | null;
  sku: string;
  name: string;
  unitPriceOverride: string | null;
};

export type SalesOrderProductSelection = {
  variantId: string;
  sku: string;
  name: string;
  caseQty: number | null;
  minOrderQty: number;
};

/**
 * Staff add the newest product at the top with a blank quantity.
 * Selecting a product already on the order moves that line to the top and leaves its quantity unchanged.
 */
export function selectSalesOrderProduct(
  lines: SalesOrderDraftLineInput[],
  hit: SalesOrderProductSelection,
): SalesOrderDraftLineInput[] {
  const existing = lines.find((line) => line.variantId === hit.variantId);
  if (!existing) {
    return [
      {
        variantId: hit.variantId,
        qty: null,
        sku: hit.sku,
        name: hit.name,
        unitPriceOverride: null,
      },
      ...lines,
    ];
  }
  return [existing, ...lines.filter((line) => line.variantId !== hit.variantId)];
}

export type SalesOrderBackorderExtent = "PARTIAL" | "FULL";

export type SalesOrderBackorderRow = {
  variantId: string;
  sku: string;
  name: string;
  orderedQty: number;
  availableQty: number;
  backorderQty: number;
  extent: SalesOrderBackorderExtent;
};

/** Lines with a backorder remainder. Backordered units are not reserved stock. */
export function salesOrderBackorderSummary(
  lines: Array<{
    variantId: string;
    sku: string;
    name: string;
    quantity: number;
    availableQtyAtOrder: number;
    backorderQtyAtOrder: number;
  }>,
): SalesOrderBackorderRow[] {
  return lines
    .filter((line) => line.backorderQtyAtOrder > 0)
    .map((line) => ({
      variantId: line.variantId,
      sku: line.sku,
      name: line.name,
      orderedQty: line.quantity,
      availableQty: line.availableQtyAtOrder,
      backorderQty: line.backorderQtyAtOrder,
      extent: line.availableQtyAtOrder > 0 ? "PARTIAL" : "FULL",
    }));
}

/**
 * A review that omitted the allocation snapshot must be repeated when any units are backordered.
 * A supplied snapshot must match the fresh available and backordered quantities.
 */
export function salesOrderAllocationChanged(
  expected: { availableQty?: number | undefined; backorderQty?: number | undefined } | undefined,
  actual: { availableQtyAtOrder: number; backorderQtyAtOrder: number },
): boolean {
  if (!expected || expected.availableQty == null || expected.backorderQty == null) {
    return actual.backorderQtyAtOrder > 0;
  }
  return (
    expected.availableQty !== actual.availableQtyAtOrder ||
    expected.backorderQty !== actual.backorderQtyAtOrder
  );
}

/**
 * One click adds one product. A second click while that add is in flight is ignored.
 * A successful add closes the result list and clears the query.
 */
export function applySalesOrderProductAdd(input: {
  busy: boolean;
  lines: SalesOrderDraftLineInput[];
  hit: SalesOrderProductSelection;
}): {
  accepted: boolean;
  busy: boolean;
  lines: SalesOrderDraftLineInput[];
  clearSearch: boolean;
} {
  if (input.busy) {
    return { accepted: false, busy: true, lines: input.lines, clearSearch: false };
  }
  return {
    accepted: true,
    busy: true,
    lines: selectSalesOrderProduct(input.lines, input.hit),
    clearSearch: true,
  };
}

function salesOrderLineObject<TQty extends number | null>(qty: z.ZodType<TQty>) {
  return z
    .object({
      variantId: z.string().cuid(),
      qty,
      unitPriceOverride: z.union([z.string(), z.null()]).optional(),
    })
    .superRefine((line, ctx) => {
      if (line.unitPriceOverride == null || line.unitPriceOverride.trim() === "") return;
      if (!parseStaffOrderUnitPrice(line.unitPriceOverride)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter a unit price in pounds and pence, excluding VAT",
          path: ["unitPriceOverride"],
        });
      }
    })
    .transform((line) => ({
      variantId: line.variantId,
      qty: line.qty,
      unitPriceOverride:
        line.unitPriceOverride == null || line.unitPriceOverride.trim() === ""
          ? null
          : parseStaffOrderUnitPrice(line.unitPriceOverride),
    }));
}

const positiveQty = z.number().int().min(1).max(99999);

/** Draft lines may stay blank. Blank is null, never 0, 1, or a case quantity. */
export const salesOrderDraftLineSchema = salesOrderLineObject(positiveQty.nullable());

/** Placement requires a positive whole number of individual units on every remaining line. */
export const salesOrderLineInputSchema = salesOrderLineObject(
  z.number({ error: "Enter a quantity for every product" }).int().min(1).max(99999),
);

export const salesOrderDraftHeaderSchema = z
  .object({
    draftId: z.string().cuid(),
    source: z.enum(SALES_ORDER_ENTRY_SOURCES).optional().nullable(),
    contactId: z.string().cuid().optional().nullable(),
    addressId: z.string().cuid().optional().nullable(),
    oneOffAddress: deliveryAddressSnapshotSchema.optional().nullable(),
    fulfilmentChoice: z.enum(ORDER_FULFILMENT_CHOICES).optional(),
    poNumber: optionalPlain(80),
    deliveryInstructions: optionalPlain(500),
    internalNote: optionalPlain(2000),
    lines: z.array(salesOrderDraftLineSchema).max(100).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.addressId && value.oneOffAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either a saved address or a one off address",
        path: ["addressId"],
      });
    }
  });

export const openSalesOrderDraftSchema = z.object({
  companyId: z.string().cuid(),
  /** When true, always create a new draft instead of resuming the latest open one. */
  fresh: z.boolean().optional(),
});

export const salesOrderDraftIdSchema = z.object({
  draftId: z.string().cuid(),
});

export const salesOrderProductSearchSchema = z.object({
  companyId: z.string().cuid(),
  q: z.string().trim().min(1).max(80),
});

/** Active-customer search for order entry. This is not the CRM customer list. */
export const salesOrderCustomerSearchSchema = z.object({
  q: z.string().trim().max(80).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
});

const reviewedMoney = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Expected a price in pounds");

/** Prices and totals the salesperson has already seen. The server compares these to a fresh resolution. */
export const salesOrderExpectedReviewSchema = z.object({
  lines: z
    .array(
      z.object({
        variantId: z.string().cuid(),
        qty: z.number().int().min(1).max(99999),
        customerUnitPrice: reviewedMoney,
        lineNet: reviewedMoney,
        availableQty: z.number().int().min(0).max(99999).optional(),
        backorderQty: z.number().int().min(0).max(99999).optional(),
      }),
    )
    .max(100),
  subtotal: reviewedMoney,
  vatTotal: reviewedMoney,
  deliveryTotal: reviewedMoney,
  grandTotal: reviewedMoney,
});

export type SalesOrderExpectedReview = z.infer<typeof salesOrderExpectedReviewSchema>;

export const placeSalesOrderSchema = z
  .object({
    draftId: z.string().cuid(),
    confirmAuthorised: z.boolean().refine((value) => value === true, {
      message: "Confirm you are authorised to place this order for the customer",
    }),
    idempotencyKey: z.string().trim().min(8).max(128),
    source: z.enum(SALES_ORDER_ENTRY_SOURCES),
    contactId: z.string().cuid().optional().nullable(),
    addressId: z.string().cuid().optional().nullable(),
    oneOffAddress: deliveryAddressSnapshotSchema.optional().nullable(),
    fulfilmentChoice: z.enum(ORDER_FULFILMENT_CHOICES).default("DELIVERY"),
    poNumber: optionalPlain(80),
    deliveryInstructions: optionalPlain(500),
    internalNote: optionalPlain(2000),
    lines: z.array(salesOrderLineInputSchema).max(100).optional(),
    /** Required when any line is backordered. The server checks the fresh allocation. */
    backorderAcknowledged: z.boolean().optional(),
    expectedLinePrices: z.array(expectedLinePriceSchema).max(100).optional().nullable(),
    /** Complete reviewed snapshot. Required for a new order. Ignored when accepting a quotation. */
    expectedReview: salesOrderExpectedReviewSchema.optional().nullable(),
    /** When set, the existing quotation is accepted instead of pricing a new order. */
    quoteId: z.string().cuid().optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.quoteId) return;
    if (!value.contactId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose the customer contact for this order",
        path: ["contactId"],
      });
    }
    if (value.addressId && value.oneOffAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either a saved address or a one off address",
        path: ["addressId"],
      });
    }
    if (value.fulfilmentChoice !== "COLLECTION" && !value.addressId && !value.oneOffAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A delivery address is required",
        path: ["addressId"],
      });
    }
  });

export type PlaceSalesOrderInput = z.infer<typeof placeSalesOrderSchema>;

export type SalesOrderContactChoice = ContactSnapshot & { id: string };
