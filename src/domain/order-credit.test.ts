import { describe, expect, it } from "vitest";
import {
  computeOverBy,
  decisionExceeds,
  decisionWithinAvailable,
  effectiveAvailableFrom,
  isCreditControlApplicable,
  orderCreditRequirementFromGrandTotal,
  sumPendingExposure,
} from "@/domain/order-credit";
import { parseMoney, moneyToString, subMoney } from "@/domain/money";

describe("order credit domain", () => {
  it("uses grand total as order credit requirement", () => {
    expect(moneyToString(orderCreditRequirementFromGrandTotal("2000.00"), 2)).toBe("2000.00");
  });

  it("maps payment terms applicability safely", () => {
    expect(
      isCreditControlApplicable({
        paymentTerms: "30 Days",
        hasVerifiedAutopartAccount: false,
        hasCreditPosition: false,
      }),
    ).toBe(false);
    expect(
      isCreditControlApplicable({
        paymentTerms: "Cash with order",
        hasVerifiedAutopartAccount: true,
        hasCreditPosition: true,
      }),
    ).toBe(false);
    expect(
      isCreditControlApplicable({
        paymentTerms: "30 Days",
        hasVerifiedAutopartAccount: true,
        hasCreditPosition: false,
      }),
    ).toBe(true);
    expect(
      isCreditControlApplicable({
        paymentTerms: null,
        hasVerifiedAutopartAccount: false,
        hasCreditPosition: true,
      }),
    ).toBe(true);
  });

  it("approves exact limit without 1p error", () => {
    const requirement = parseMoney("1505.25")!;
    const imported = parseMoney("1505.25")!;
    const pending = parseMoney("0")!;
    const effective = effectiveAvailableFrom(imported, pending);
    expect(effective.minor).toBe(requirement.minor);
    const d = decisionWithinAvailable({
      requirement,
      creditLimit: parseMoney("5000")!,
      autopartExposure: parseMoney("3494.75")!,
      importedAvailable: imported,
      pendingAbExposure: pending,
      effectiveAvailable: effective,
      snapshotUpdatedAt: new Date("2026-09-28T12:00:00Z"),
      freshness: "CURRENT",
    });
    expect(d.creditStatus).toBe("APPROVED");
    expect(d.remainingEffectiveCapacity).toBe("0.00");
  });

  it("hold regression: £2,000 vs £1,505.25 → over £494.75", () => {
    const requirement = parseMoney("2000.00")!;
    const imported = parseMoney("1505.25")!;
    const pending = parseMoney("0")!;
    const effective = effectiveAvailableFrom(imported, pending);
    const d = decisionExceeds({
      requirement,
      creditLimit: parseMoney("5000")!,
      autopartExposure: parseMoney("3494.75")!,
      importedAvailable: imported,
      pendingAbExposure: pending,
      effectiveAvailable: effective,
      snapshotUpdatedAt: new Date("2026-09-28T12:00:00Z"),
      freshness: "CURRENT",
      alreadyOverLimit: false,
    });
    expect(d.creditStatus).toBe("HOLD");
    expect(d.reason).toBe("EXCEEDS_AVAILABLE_CREDIT");
    expect(d.overBy).toBe("494.75");
  });

  it("pending exposure reduces effective available", () => {
    const imported = parseMoney("1505.25")!;
    const pending = sumPendingExposure(["1000.00"]);
    const effective = effectiveAvailableFrom(imported, pending);
    expect(moneyToString(effective, 2)).toBe("505.25");
    const over = computeOverBy(parseMoney("1000")!, effective);
    expect(moneyToString(over, 2)).toBe("494.75");
  });

  it("preserves already-over-limit raw available", () => {
    const imported = parseMoney("-400.00")!;
    const effective = subMoney(imported, parseMoney("0")!);
    const d = decisionExceeds({
      requirement: parseMoney("100")!,
      creditLimit: parseMoney("5000")!,
      autopartExposure: parseMoney("5400")!,
      importedAvailable: imported,
      pendingAbExposure: parseMoney("0")!,
      effectiveAvailable: effective,
      snapshotUpdatedAt: new Date("2026-09-28T12:00:00Z"),
      freshness: "CURRENT",
      alreadyOverLimit: true,
    });
    expect(d.reason).toBe("ACCOUNT_ALREADY_OVER_CREDIT_LIMIT");
    expect(d.importedAvailableCredit).toBe("-400.00");
  });
});
