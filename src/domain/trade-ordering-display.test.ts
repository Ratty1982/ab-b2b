import { describe, expect, it } from "vitest";
import {
  applyVatInc,
  customerLineNetExVat,
  formatCustomerSellUnitPrice,
  formatTradeOrderingUnitPrice,
  moneyToString,
  parseMoney,
  toCustomerSellUnitPrice,
} from "@/domain/money";

describe("toCustomerSellUnitPrice", () => {
  it("rounds commercial 10.1050 to customer sell £10.11", () => {
    const sell = toCustomerSellUnitPrice(parseMoney("10.1050")!);
    expect(moneyToString(sell, 2)).toBe("10.11");
    expect(formatCustomerSellUnitPrice("10.1050")).toBe("10.11");
  });

  it("rounds commercial 3.6875 to customer sell £3.69", () => {
    const sell = toCustomerSellUnitPrice(parseMoney("3.6875")!);
    expect(moneyToString(sell, 2)).toBe("3.69");
    expect(formatCustomerSellUnitPrice("3.6875")).toBe("3.69");
  });

  it("keeps exact pennies such as 2.1900 as £2.19", () => {
    expect(formatCustomerSellUnitPrice("2.1900")).toBe("2.19");
    expect(formatTradeOrderingUnitPrice("2.1900")).toBe("2.19");
  });

  it("never exposes 3dp/4dp on the customer-facing formatter", () => {
    expect(formatCustomerSellUnitPrice("10.1050")).not.toBe("10.105");
    expect(formatCustomerSellUnitPrice("3.6875")).not.toBe("3.6875");
    expect(formatCustomerSellUnitPrice("1.1250")).toBe("1.13");
  });
});

describe("customerLineNetExVat", () => {
  it("PMCAT: 12 × £10.11 = £121.32 (not £10.105 × 12 = £121.26)", () => {
    const line = customerLineNetExVat(parseMoney("10.1050")!, 12);
    expect(moneyToString(line, 2)).toBe("121.32");
  });

  it("PMML500SC40: 12 × £3.69 = £44.28 (not £3.6875 × 12 = £44.25)", () => {
    const line = customerLineNetExVat(parseMoney("3.6875")!, 12);
    expect(moneyToString(line, 2)).toBe("44.28");
  });

  it("single-unit caseQty 1 uses the same sell-unit rule", () => {
    expect(moneyToString(customerLineNetExVat(parseMoney("2.1900")!, 1), 2)).toBe("2.19");
    expect(moneyToString(customerLineNetExVat(parseMoney("2.1900")!, 3), 2)).toBe("6.57");
  });

  it("quantity-break style re-resolve: new commercial price is rounded again", () => {
    const at12 = customerLineNetExVat(parseMoney("10.1050")!, 12);
    expect(moneyToString(at12, 2)).toBe("121.32");
    // Break at 24 resolves 9.8765 → sell £9.88 × 24
    const at24 = customerLineNetExVat(parseMoney("9.8765")!, 24);
    expect(formatCustomerSellUnitPrice("9.8765")).toBe("9.88");
    expect(moneyToString(at24, 2)).toBe("237.12");
  });

  it("VAT consumes the customer line net (standard 20%)", () => {
    const lineNet = customerLineNetExVat(parseMoney("10.1050")!, 12);
    const gross = applyVatInc(lineNet, parseMoney("0.20")!);
    expect(moneyToString(lineNet, 2)).toBe("121.32");
    expect(moneyToString(gross, 2)).toBe("145.58");
  });
});
