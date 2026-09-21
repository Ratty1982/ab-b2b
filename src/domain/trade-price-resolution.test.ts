import { describe, expect, it } from "vitest";
import {
  applyVatInc,
  moneyToNumber,
  moneyToString,
  parseMoney,
  roundGbpDisplay,
  vatRateForCodes,
} from "@/domain/money";
import {
  applyPromotion,
  inValidityWindow,
  resolveTradePriceFromFacts,
  selectQuantityBreak,
  type PriceResolutionFacts,
} from "@/domain/trade-price-resolution";

function facts(partial: Partial<PriceResolutionFacts> = {}): PriceResolutionFacts {
  return {
    variantId: "var-gc5000",
    sku: "GC5000",
    baseTradePrice: "8.6967",
    vatCode: "STANDARD",
    quantity: 1,
    at: new Date("2026-09-21T12:00:00.000Z"),
    company: null,
    customerPrice: null,
    priceListItem: null,
    quantityBreaks: [{ id: "qb-base", minQty: 1, unitPrice: "8.6967" }],
    promotions: [],
    ...partial,
  };
}

describe("money rounding", () => {
  it("keeps 4dp commercial values and half-up display pennies", () => {
    const stored = parseMoney("8.6967")!;
    expect(moneyToString(stored)).toBe("8.6967");
    expect(moneyToString(roundGbpDisplay(stored), 2)).toBe("8.70");
    expect(moneyToNumber(stored)).toBe(8.6967);
  });

  it("computes 20% VAT inc from 4dp ex", () => {
    const unit = parseMoney("8.6967")!;
    const vat = vatRateForCodes({ vatCode: "STANDARD" });
    expect(vat.percent).toBe(20);
    expect(moneyToString(applyVatInc(unit, vat.rate), 2)).toBe("10.44");
  });

  it("uses 0% VAT for zero-rated products and exempt companies", () => {
    expect(vatRateForCodes({ vatCode: "ZERO_RATED" }).percent).toBe(0);
    expect(vatRateForCodes({ vatCode: "STANDARD", companyTaxStatus: "EXEMPT" }).percent).toBe(0);
  });
});

describe("trade price precedence", () => {
  it("uses base trade when no company terms exist", () => {
    const resolved = resolveTradePriceFromFacts(facts());
    expect(resolved.source).toBe("BASE");
    expect(resolved.unitPriceExVat).toBe("8.6967");
    expect(resolved.unitPriceExVatDisplay).toBe("8.70");
  });

  it("uses assigned price-list over base", () => {
    const resolved = resolveTradePriceFromFacts(
      facts({
        company: { id: "co-a", taxStatus: "STANDARD", priceListId: "pl-d", priceListName: "Distributor" },
        priceListItem: { id: "pli-1", unitPrice: "7.6000", priceListId: "pl-d", priceListName: "Distributor" },
      }),
    );
    expect(resolved.source).toBe("PRICE_LIST");
    expect(resolved.unitPriceExVat).toBe("7.6000");
    expect(resolved.explanation.priceListName).toBe("Distributor");
  });

  it("uses customer override over price list", () => {
    const resolved = resolveTradePriceFromFacts(
      facts({
        company: { id: "co-a", taxStatus: "STANDARD", priceListId: "pl-d", priceListName: "Distributor" },
        priceListItem: { id: "pli-1", unitPrice: "7.6000", priceListId: "pl-d", priceListName: "Distributor" },
        customerPrice: { id: "cp-1", unitPrice: "7.9500", startsAt: null, endsAt: null },
      }),
    );
    expect(resolved.source).toBe("CUSTOMER");
    expect(resolved.unitPriceExVat).toBe("7.9500");
  });

  it("ignores another company's customer price when facts omit it", () => {
    const a = resolveTradePriceFromFacts(
      facts({
        company: { id: "co-a", taxStatus: "STANDARD", priceListId: null, priceListName: null },
        customerPrice: { id: "cp-a", unitPrice: "7.9500", startsAt: null, endsAt: null },
      }),
    );
    const b = resolveTradePriceFromFacts(
      facts({
        company: { id: "co-b", taxStatus: "STANDARD", priceListId: null, priceListName: null },
        customerPrice: null,
      }),
    );
    expect(a.unitPriceExVat).toBe("7.9500");
    expect(b.unitPriceExVat).toBe("8.6967");
    expect(b.source).toBe("BASE");
  });
});

describe("quantity breaks", () => {
  it("ignores the minQty=1 base mirror and thresholds around 10 with case-sized qty", () => {
    const breaks = [
      { id: "qb-base", minQty: 1, unitPrice: "8.6967" },
      { id: "qb-10", minQty: 10, unitPrice: "8.2000" },
    ];
    expect(selectQuantityBreak(breaks, 9)).toBeNull();
    expect(selectQuantityBreak(breaks, 10)?.minQty).toBe(10);
    expect(selectQuantityBreak(breaks, 12)?.minQty).toBe(10);
    expect(selectQuantityBreak(breaks, 1)).toBeNull();
  });

  it("applies a volume break only when cheaper than commercial", () => {
    const below = resolveTradePriceFromFacts(facts({ quantity: 2, quantityBreaks: [{ id: "qb-10", minQty: 10, unitPrice: "8.2000" }] }));
    expect(below.source).toBe("BASE");
    const at = resolveTradePriceFromFacts(facts({ quantity: 10, quantityBreaks: [{ id: "qb-10", minQty: 10, unitPrice: "8.2000" }] }));
    expect(at.source).toBe("QUANTITY_BREAK");
    expect(at.unitPriceExVat).toBe("8.2000");
    const worse = resolveTradePriceFromFacts(
      facts({
        customerPrice: { id: "cp-1", unitPrice: "7.0000", startsAt: null, endsAt: null },
        quantity: 10,
        quantityBreaks: [{ id: "qb-10", minQty: 10, unitPrice: "8.2000" }],
      }),
    );
    expect(worse.source).toBe("CUSTOMER");
    expect(worse.unitPriceExVat).toBe("7.0000");
  });
});

describe("promotions", () => {
  const windowed = {
    id: "pr-1",
    code: "SPRING10",
    name: "Spring",
    type: "PERCENT" as const,
    value: "10",
    startsAt: new Date("2026-09-01T00:00:00.000Z"),
    endsAt: new Date("2026-09-30T23:59:59.000Z"),
    isActive: true,
    variantIds: null,
    skus: null,
  };

  it("ignores future, expired, inactive, and quantity-deal promotions", () => {
    const during = resolveTradePriceFromFacts(facts({ promotions: [windowed] }));
    expect(during.source).toBe("PROMOTION");
    expect(during.unitPriceExVatDisplay).toBe("7.83");

    const before = resolveTradePriceFromFacts(
      facts({ at: new Date("2026-08-01T00:00:00.000Z"), promotions: [windowed] }),
    );
    expect(before.source).toBe("BASE");

    const after = resolveTradePriceFromFacts(
      facts({ at: new Date("2026-10-01T00:00:00.000Z"), promotions: [windowed] }),
    );
    expect(after.source).toBe("BASE");

    const inactive = resolveTradePriceFromFacts(facts({ promotions: [{ ...windowed, isActive: false }] }));
    expect(inactive.source).toBe("BASE");

    const deal = resolveTradePriceFromFacts(facts({ promotions: [{ ...windowed, type: "QUANTITY_DEAL" }] }));
    expect(deal.source).toBe("BASE");
  });

  it("does not stack promotions and picks the lowest resulting unit price deterministically", () => {
    const ten = { ...windowed, id: "a", code: "AAA10", value: "10" };
    const twenty = { ...windowed, id: "b", code: "BBB20", value: "20" };
    const resolved = resolveTradePriceFromFacts(facts({ promotions: [ten, twenty] }));
    expect(resolved.promotionApplied?.code).toBe("BBB20");
    expect(resolved.source).toBe("PROMOTION");
    const applied = applyPromotion(parseMoney("8.6967")!, twenty)!;
    expect(resolved.unitPriceExVat).toBe(moneyToString(applied));
  });

  it("respects validity helpers", () => {
    const at = new Date("2026-09-21T00:00:00.000Z");
    expect(inValidityWindow(at, null, null)).toBe(true);
    expect(inValidityWindow(at, new Date("2026-09-22T00:00:00.000Z"), null)).toBe(false);
  });
});

describe("VAT in resolution", () => {
  it("returns 20% inc VAT and 0% when zero-rated", () => {
    const std = resolveTradePriceFromFacts(facts());
    expect(std.vatPercent).toBe(20);
    expect(std.unitPriceIncVat).toBe("10.44");
    const zero = resolveTradePriceFromFacts(facts({ vatCode: "ZERO_RATED" }));
    expect(zero.vatPercent).toBe(0);
    expect(zero.unitPriceIncVat).toBe("8.70");
  });
});
