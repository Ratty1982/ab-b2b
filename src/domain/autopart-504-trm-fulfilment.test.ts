import { describe, expect, it } from "vitest";
import {
  describeCreditsHandling,
  evaluateOrder504TrmFulfilment,
  isAfterFulfilmentFrom,
  matchAbOrderNumber,
  matchTrmSkuToOrderItem,
  parseExactAbOrderReference,
  positiveInvoiceUnits,
} from "@/domain/autopart-504-trm-fulfilment";

const from = new Date("2026-10-01T12:00:00.000Z");

function item(id: string, sku: string, qty: number, name = sku) {
  return { id, sku, name, qty };
}

function invoiceDoc(opts: {
  id?: string;
  ref: string;
  order: string;
  goods: string | null;
  lines: Array<{ sku: string; units: number; salesNet: string }>;
  has504?: boolean;
  hasTrm?: boolean;
  date?: Date;
  type?: string;
}) {
  return {
    id: opts.id ?? opts.ref,
    documentReference: opts.ref,
    documentType: opts.type ?? "INVOICE",
    documentDate: opts.date ?? new Date("2026-10-06T12:00:00.000Z"),
    createdAt: new Date("2026-10-06T13:00:00.000Z"),
    has504: opts.has504 ?? true,
    hasTrm21qc: opts.hasTrm ?? true,
    goodsNet: opts.goods,
    customerOrderNumber: opts.order,
    abOrderNumber: opts.order,
    abOrderId: "ord-1",
    lines: opts.lines.map((l) => ({ sku: l.sku, units: l.units, salesNet: l.salesNet })),
  };
}

describe("AB order matching", () => {
  it("matches exact AB-###### with trim/case normalisation", () => {
    expect(parseExactAbOrderReference(" ab-001234 ")).toBe("AB-001234");
    expect(matchAbOrderNumber("AB-001234", "ab-001234")).toBe(true);
    expect(matchAbOrderNumber("  AB-001234  ", "AB-001234")).toBe(true);
  });

  it("does not match non-AB, numeric-only, substring, or name guesses", () => {
    expect(parseExactAbOrderReference("MAM-ONLY-1")).toBeNull();
    expect(parseExactAbOrderReference("001234")).toBeNull();
    expect(parseExactAbOrderReference("ORDER AB-001234")).toBeNull();
    expect(parseExactAbOrderReference("Car Shop Pit Stop Ltd")).toBeNull();
    expect(matchAbOrderNumber("AB-001234", "AB-001235")).toBe(false);
    expect(matchAbOrderNumber("AB-12", "AB-12")).toBe(false);
  });
});

describe("SKU matching", () => {
  it("matches SKU exactly ignoring case/whitespace", () => {
    const items = [item("1", "PMAPC500", 12), item("2", "GC5000", 4)];
    expect(matchTrmSkuToOrderItem("pmapc500", items)).toEqual({
      ok: true,
      orderItemId: "1",
      sku: "PMAPC500",
    });
    expect(matchTrmSkuToOrderItem("NOPE", items)).toEqual({
      ok: false,
      sku: "NOPE",
      reason: "UNMATCHED_SKU",
    });
  });

  it("does not fuzzy-match descriptions or collapse duplicate SKUs", () => {
    const dup = [item("1", "AA", 1, "Engine"), item("2", "AA", 1, "Engine")];
    expect(matchTrmSkuToOrderItem("AA", dup).ok).toBe(false);
  });
});

describe("quantity / credits", () => {
  it("uses positive invoice units and ignores credits", () => {
    expect(positiveInvoiceUnits("6")).toBe(6);
    expect(positiveInvoiceUnits(-2)).toBe(0);
    expect(positiveInvoiceUnits("-1.000")).toBe(0);
    expect(describeCreditsHandling()).toMatch(/does not reverse physical despatch/i);
  });

  it("activation boundary is date-only", () => {
    expect(
      isAfterFulfilmentFrom(new Date("2026-09-30T12:00:00.000Z"), new Date(), from),
    ).toBe(false);
    expect(
      isAfterFulfilmentFrom(new Date("2026-10-01T00:00:00.000Z"), new Date(), from),
    ).toBe(true);
  });
});

describe("cumulative fulfilment", () => {
  it("full invoice of A×10 → DESPATCHED", () => {
    const result = evaluateOrder504TrmFulfilment({
      orderId: "o1",
      orderNumber: "AB-100001",
      orderStatus: "CONFIRMED",
      items: [item("a", "A", 10)],
      fulfilmentFrom: from,
      documents: [
        invoiceDoc({
          ref: "SS1",
          order: "AB-100001",
          goods: "10.00",
          lines: [{ sku: "A", units: 10, salesNet: "10.00" }],
        }),
      ],
    });
    expect(result.conceptually).toBe("DISPATCHED");
    expect(result.nextStatus).toBe("DISPATCHED");
    expect(result.lines[0]?.despatchedQty).toBe(10);
    expect(result.canApply).toBe(true);
  });

  it("partial A×6 of 10 then later A×4 → DESPATCHED", () => {
    const items = [item("a", "A", 10)];
    const first = evaluateOrder504TrmFulfilment({
      orderId: "o1",
      orderNumber: "AB-100001",
      orderStatus: "CONFIRMED",
      items,
      fulfilmentFrom: from,
      documents: [
        invoiceDoc({
          ref: "SS1",
          order: "AB-100001",
          goods: "6.00",
          lines: [{ sku: "A", units: 6, salesNet: "6.00" }],
        }),
      ],
    });
    expect(first.conceptually).toBe("PARTIALLY_DESPATCHED");
    expect(first.lines[0]?.despatchedQty).toBe(6);
    expect(first.lines[0]?.remainingQty).toBe(4);

    const second = evaluateOrder504TrmFulfilment({
      orderId: "o1",
      orderNumber: "AB-100001",
      orderStatus: "PARTIALLY_DESPATCHED",
      items,
      fulfilmentFrom: from,
      alreadyAppliedDocumentNumbers: ["SS1"],
      documents: [
        invoiceDoc({
          ref: "SS1",
          order: "AB-100001",
          goods: "6.00",
          lines: [{ sku: "A", units: 6, salesNet: "6.00" }],
        }),
        invoiceDoc({
          ref: "SS2",
          order: "AB-100001",
          goods: "4.00",
          lines: [{ sku: "A", units: 4, salesNet: "4.00" }],
        }),
      ],
    });
    expect(second.conceptually).toBe("DISPATCHED");
    expect(second.lines[0]?.despatchedQty).toBe(10);
    expect(second.newInvoiceDocumentNumbers).toEqual(["SS2"]);
  });

  it("multi-line A×10 B×5 / first invoice A×6 B×5 → PARTIAL then A×4 → DESPATCHED", () => {
    const items = [item("a", "A", 10), item("b", "B", 5)];
    const first = evaluateOrder504TrmFulfilment({
      orderId: "o1",
      orderNumber: "AB-100001",
      orderStatus: "CONFIRMED",
      items,
      fulfilmentFrom: from,
      documents: [
        invoiceDoc({
          ref: "SS100001",
          order: "AB-100001",
          goods: "11.00",
          lines: [
            { sku: "A", units: 6, salesNet: "6.00" },
            { sku: "B", units: 5, salesNet: "5.00" },
          ],
        }),
      ],
    });
    expect(first.conceptually).toBe("PARTIALLY_DESPATCHED");
    expect(first.lines.find((l) => l.sku === "A")?.despatchedQty).toBe(6);
    expect(first.lines.find((l) => l.sku === "B")?.despatchedQty).toBe(5);

    const second = evaluateOrder504TrmFulfilment({
      orderId: "o1",
      orderNumber: "AB-100001",
      orderStatus: "PARTIALLY_DESPATCHED",
      items,
      fulfilmentFrom: from,
      documents: [
        invoiceDoc({
          ref: "SS100001",
          order: "AB-100001",
          goods: "11.00",
          lines: [
            { sku: "A", units: 6, salesNet: "6.00" },
            { sku: "B", units: 5, salesNet: "5.00" },
          ],
        }),
        invoiceDoc({
          ref: "SS100050",
          order: "AB-100001",
          goods: "4.00",
          lines: [{ sku: "A", units: 4, salesNet: "4.00" }],
        }),
      ],
    });
    expect(second.conceptually).toBe("DISPATCHED");
  });

  it("duplicate report does not invent extra quantity", () => {
    const result = evaluateOrder504TrmFulfilment({
      orderId: "o1",
      orderNumber: "AB-100001",
      orderStatus: "CONFIRMED",
      items: [item("a", "A", 10)],
      fulfilmentFrom: from,
      documents: [
        invoiceDoc({
          ref: "SS1",
          order: "AB-100001",
          goods: "10.00",
          lines: [{ sku: "A", units: 10, salesNet: "10.00" }],
        }),
      ],
    });
    const again = evaluateOrder504TrmFulfilment({
      orderId: "o1",
      orderNumber: "AB-100001",
      orderStatus: "DISPATCHED",
      items: [item("a", "A", 10)],
      fulfilmentFrom: from,
      alreadyAppliedDocumentNumbers: ["SS1"],
      documents: [
        invoiceDoc({
          ref: "SS1",
          order: "AB-100001",
          goods: "10.00",
          lines: [{ sku: "A", units: 10, salesNet: "10.00" }],
        }),
      ],
    });
    expect(result.lines[0]?.despatchedQty).toBe(10);
    expect(again.lines[0]?.despatchedQty).toBe(10);
    expect(again.newInvoiceDocumentNumbers).toEqual([]);
    expect(again.nextStatus).toBeNull();
  });

  it("over-fulfilment flags review and does not change ordered qty", () => {
    const result = evaluateOrder504TrmFulfilment({
      orderId: "o1",
      orderNumber: "AB-100001",
      orderStatus: "CONFIRMED",
      items: [item("a", "A", 10)],
      fulfilmentFrom: from,
      documents: [
        invoiceDoc({
          ref: "SS1",
          order: "AB-100001",
          goods: "12.00",
          lines: [{ sku: "A", units: 12, salesNet: "12.00" }],
        }),
      ],
    });
    expect(result.overFulfilment).toBe(true);
    expect(result.warnings.some((w) => w.includes("OVER-FULFILMENT"))).toBe(true);
    expect(result.lines[0]?.orderedQty).toBe(10);
    expect(result.lines[0]?.invoicedQty).toBe(12);
    expect(result.lines[0]?.despatchedQty).toBe(10);
    expect(result.conceptually).toBe("DISPATCHED");
  });

  it("unknown SKU does not assume fulfilment", () => {
    const result = evaluateOrder504TrmFulfilment({
      orderId: "o1",
      orderNumber: "AB-100001",
      orderStatus: "CONFIRMED",
      items: [item("a", "A", 10)],
      fulfilmentFrom: from,
      documents: [
        invoiceDoc({
          ref: "SS1",
          order: "AB-100001",
          goods: "10.00",
          lines: [{ sku: "ZZZ", units: 10, salesNet: "10.00" }],
        }),
      ],
    });
    expect(result.lineMatchReview).toBe(true);
    expect(result.lines[0]?.despatchedQty).toBe(0);
    expect(result.conceptually).toBe("REVIEW_ONLY");
  });

  it("TRM first waits for 504; 504 first waits for TRM", () => {
    const trmFirst = evaluateOrder504TrmFulfilment({
      orderId: "o1",
      orderNumber: "AB-100001",
      orderStatus: "CONFIRMED",
      items: [item("a", "A", 10)],
      fulfilmentFrom: from,
      documents: [
        invoiceDoc({
          ref: "SS1",
          order: "AB-100001",
          goods: null,
          has504: false,
          hasTrm: true,
          lines: [{ sku: "A", units: 10, salesNet: "10.00" }],
        }),
      ],
    });
    expect(trmFirst.waitingFor504).toBe(true);
    expect(trmFirst.canApply).toBe(false);

    const fiveFirst = evaluateOrder504TrmFulfilment({
      orderId: "o1",
      orderNumber: "AB-100001",
      orderStatus: "CONFIRMED",
      items: [item("a", "A", 10)],
      fulfilmentFrom: from,
      documents: [
        invoiceDoc({
          ref: "SS1",
          order: "AB-100001",
          goods: "10.00",
          has504: true,
          hasTrm: false,
          lines: [],
        }),
      ],
    });
    expect(fiveFirst.waitingForTrm).toBe(true);
    expect(fiveFirst.canApply).toBe(false);
  });

  it("financial mismatch does not apply fulfilment", () => {
    const result = evaluateOrder504TrmFulfilment({
      orderId: "o1",
      orderNumber: "AB-100001",
      orderStatus: "CONFIRMED",
      items: [item("a", "A", 10)],
      fulfilmentFrom: from,
      documents: [
        invoiceDoc({
          ref: "SS1",
          order: "AB-100001",
          goods: "10.00",
          lines: [{ sku: "A", units: 10, salesNet: "9.50" }],
        }),
      ],
    });
    expect(result.financialReview).toBe(true);
    expect(result.canApply).toBe(false);
    expect(result.lines[0]?.despatchedQty).toBe(0);
  });

  it("credits never despatch", () => {
    const result = evaluateOrder504TrmFulfilment({
      orderId: "o1",
      orderNumber: "AB-100001",
      orderStatus: "CONFIRMED",
      items: [item("a", "A", 10)],
      fulfilmentFrom: from,
      documents: [
        invoiceDoc({
          ref: "SC1",
          order: "AB-100001",
          goods: "-10.00",
          type: "CREDIT",
          lines: [{ sku: "A", units: -10, salesNet: "-10.00" }],
        }),
      ],
    });
    expect(result.documents[0]?.status).toBe("SKIPPED_CREDIT");
    expect(result.canApply).toBe(false);
    expect(result.conceptually).toBe("NO_AUTOPART_FULFILMENT");
  });

  it("cancelled orders are not mutated", () => {
    const result = evaluateOrder504TrmFulfilment({
      orderId: "o1",
      orderNumber: "AB-100001",
      orderStatus: "CANCELLED",
      items: [item("a", "A", 10)],
      fulfilmentFrom: from,
      documents: [
        invoiceDoc({
          ref: "SS1",
          order: "AB-100001",
          goods: "10.00",
          lines: [{ sku: "A", units: 10, salesNet: "10.00" }],
        }),
      ],
    });
    expect(result.canApply).toBe(false);
    expect(result.nextStatus).toBeNull();
    expect(result.documents[0]?.status).toBe("SKIPPED_TERMINAL");
  });

  it("customer name / non-AB reference does not match", () => {
    const result = evaluateOrder504TrmFulfilment({
      orderId: "o1",
      orderNumber: "AB-100001",
      orderStatus: "CONFIRMED",
      items: [item("a", "A", 10)],
      fulfilmentFrom: from,
      documents: [
        invoiceDoc({
          ref: "SS1",
          order: "KEITH051026",
          goods: "10.00",
          lines: [{ sku: "A", units: 10, salesNet: "10.00" }],
        }),
      ],
    });
    expect(result.documents[0]?.status).toBe("NOT_AB_ORDER");
    expect(result.canApply).toBe(false);
  });

  it("historic documents before activation are skipped", () => {
    const result = evaluateOrder504TrmFulfilment({
      orderId: "o1",
      orderNumber: "AB-100001",
      orderStatus: "CONFIRMED",
      items: [item("a", "A", 10)],
      fulfilmentFrom: from,
      documents: [
        invoiceDoc({
          ref: "SS1",
          order: "AB-100001",
          goods: "10.00",
          date: new Date("2026-09-01T12:00:00.000Z"),
          lines: [{ sku: "A", units: 10, salesNet: "10.00" }],
        }),
      ],
    });
    expect(result.documents[0]?.status).toBe("SKIPPED_BEFORE_FROM");
    expect(result.canApply).toBe(false);
  });
});
