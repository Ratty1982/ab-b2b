import { describe, expect, it } from "vitest";
import {
  applyVatInc,
  moneyToString,
  moneyZero,
  parseMoney,
  subMoney,
} from "@/domain/money";
import {
  TRADE_DELIVERY_CHARGE_EX_VAT,
  TRADE_FREE_DELIVERY_THRESHOLD_EX_VAT,
  calculateTradeDeliveryNet,
  calculateTradeOrderTotals,
  freeDeliveryProgressPercent,
  tradeDeliveryTotalsDto,
} from "@/domain/trade-delivery";

function goodsVatAt20(goodsNet: string) {
  const net = parseMoney(goodsNet)!;
  return subMoney(applyVatInc(net, parseMoney("0.20")!), net);
}

describe("trade delivery charge", () => {
  it("uses £150 goods ex VAT threshold and £5.95 carriage", () => {
    expect(moneyToString(TRADE_FREE_DELIVERY_THRESHOLD_EX_VAT, 2)).toBe("150.00");
    expect(moneyToString(TRADE_DELIVERY_CHARGE_EX_VAT, 2)).toBe("5.95");
  });

  it.each([
    ["0.00", "5.95"],
    ["25.72", "5.95"],
    ["149.98", "5.95"],
    ["149.99", "5.95"],
    ["150.00", "0.00"],
    ["150.01", "0.00"],
    ["500.00", "0.00"],
  ] as const)("goods %s → delivery %s", (goods, delivery) => {
    expect(moneyToString(calculateTradeDeliveryNet(parseMoney(goods)!), 2)).toBe(delivery);
  });

  it("matches the £25.72 screenshot example with standard VAT", () => {
    const shot = calculateTradeOrderTotals({
      goodsNet: parseMoney("25.72")!,
      goodsVat: goodsVatAt20("25.72"),
      companyTaxStatus: "STANDARD",
    });
    expect(moneyToString(shot.goodsNet, 2)).toBe("25.72");
    expect(moneyToString(shot.deliveryNet, 2)).toBe("5.95");
    expect(moneyToString(shot.vatTotal, 2)).toBe("6.33");
    expect(moneyToString(shot.grandTotal, 2)).toBe("38.00");
    expect(shot.freeDelivery).toBe(false);
    expect(moneyToString(shot.amountToFreeDelivery!, 2)).toBe("124.28");
  });

  it("gives FREE delivery at exactly £150.00 goods", () => {
    const goods = parseMoney("150.00")!;
    const totals = calculateTradeOrderTotals({
      goodsNet: goods,
      goodsVat: goodsVatAt20("150.00"),
      companyTaxStatus: "STANDARD",
    });
    expect(totals.freeDelivery).toBe(true);
    expect(moneyToString(totals.deliveryNet, 2)).toBe("0.00");
    expect(totals.amountToFreeDelivery).toBeNull();
    const dto = tradeDeliveryTotalsDto(totals);
    expect(dto.deliveryLabel).toBe("FREE");
    expect(dto.deliveryTotal).toBe("0.00");
  });

  it("charges delivery just below threshold (£149.99)", () => {
    const totals = calculateTradeOrderTotals({
      goodsNet: parseMoney("149.99")!,
      goodsVat: goodsVatAt20("149.99"),
      companyTaxStatus: "STANDARD",
    });
    expect(moneyToString(totals.deliveryNet, 2)).toBe("5.95");
    expect(moneyToString(totals.amountToFreeDelivery!, 2)).toBe("0.01");
    expect(totals.progressPercent).toBe(99.99);
    expect(totals.freeDelivery).toBe(false);
  });

  it("exposes free-delivery progress for the £44.28 basket UX case", () => {
    const totals = calculateTradeOrderTotals({
      goodsNet: parseMoney("44.28")!,
      goodsVat: goodsVatAt20("44.28"),
      companyTaxStatus: "STANDARD",
    });
    expect(moneyToString(totals.goodsNet, 2)).toBe("44.28");
    expect(moneyToString(totals.deliveryNet, 2)).toBe("5.95");
    expect(moneyToString(totals.vatTotal, 2)).toBe("10.05");
    expect(moneyToString(totals.grandTotal, 2)).toBe("60.28");
    expect(moneyToString(totals.amountToFreeDelivery!, 2)).toBe("105.72");
    expect(totals.progressPercent).toBe(29.52);
    expect(totals.freeDelivery).toBe(false);

    const dto = tradeDeliveryTotalsDto(totals);
    expect(dto.thresholdExVat).toBe("150.00");
    expect(dto.progressPercent).toBe(29.52);
    expect(dto.amountToFreeDelivery).toBe("105.72");
    expect(dto.deliveryLabel).toBe("£5.95");
  });

  it("caps progress at 100% when free delivery is unlocked", () => {
    const totals = calculateTradeOrderTotals({
      goodsNet: parseMoney("200.00")!,
      goodsVat: goodsVatAt20("200.00"),
      companyTaxStatus: "STANDARD",
    });
    expect(totals.freeDelivery).toBe(true);
    expect(totals.progressPercent).toBe(100);
    expect(freeDeliveryProgressPercent(parseMoney("150.00")!)).toBe(100);
    expect(freeDeliveryProgressPercent(parseMoney("0.00")!)).toBe(0);
  });

  it("zeroes delivery VAT for VAT-exempt companies", () => {
    const totals = calculateTradeOrderTotals({
      goodsNet: parseMoney("25.72")!,
      goodsVat: moneyZero(),
      companyTaxStatus: "EXEMPT",
    });
    expect(moneyToString(totals.deliveryNet, 2)).toBe("5.95");
    expect(moneyToString(totals.deliveryVat, 2)).toBe("0.00");
    expect(moneyToString(totals.vatTotal, 2)).toBe("0.00");
    expect(moneyToString(totals.grandTotal, 2)).toBe("31.67");
  });
});
